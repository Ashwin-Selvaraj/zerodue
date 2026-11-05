import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:zerodue/core/api.dart';
import 'package:zerodue/core/capture.dart';
import 'package:zerodue/core/models.dart';
import 'package:zerodue/core/notification_action.dart';
import 'package:zerodue/core/notification_plan.dart';
import 'package:zerodue/core/session_store.dart';
import 'package:zerodue/core/sms_parser.dart';
import 'package:zerodue/core/store.dart';

import 'support.dart';

const bankSms =
    'ICICI Bank Acct XX123 debited for Rs 450.00 on 05-Nov-26; SHELL PETROL PUMP credited. UPI:312345678901.';
final arrived = DateTime.utc(2026, 11, 5, 4, 40);

void main() {
  late MemoryStore store;
  late FakeServer server;
  late CaptureService capture;

  Future<void> pairedWith(FakeServer s) async {
    await SessionStore(store).save(
      const Session(
          apiUrl: 'https://zerodue.example',
          deviceToken: 'zd_dev_test',
          deviceId: 'd1',
          salt: 'salt'),
    );
  }

  setUp(() async {
    store = MemoryStore();
    server = FakeServer((r, b) => json(200, ingestJson()));
    capture = CaptureService(store,
        apiFor: (s) =>
            ApiClient(s.apiUrl, token: s.deviceToken, client: server.client));
    await pairedWith(server);
  });

  group('pairing', () {
    test('trades the code for a session and then loads the config', () async {
      final fresh = MemoryStore();
      final pairing = FakeServer((r, b) {
        if (r.url.path == '/devices/pair') {
          return json(200, {'deviceId': 'd9', 'deviceToken': 'zd_dev_new'});
        }
        return json(200, {
          'allowList': ['*-ICICIB'],
          'quickPicks': [
            {'id': 'f', 'name': 'Fuel'}
          ]
        });
      });
      final service = CaptureService(
        fresh,
        anonymousApi: (url) => ApiClient(url, client: pairing.client),
        apiFor: (s) =>
            ApiClient(s.apiUrl, token: s.deviceToken, client: pairing.client),
      );
      await service.pair('zerodue.example/', 'ABCD1234', 'Pixel');
      final session = (await service.session())!;
      expect(session.apiUrl, 'https://zerodue.example');
      expect(session.deviceToken, 'zd_dev_new');
      expect(session.deviceId, 'd9');
      expect(session.salt, hasLength(32));
      expect(session.quickPicks.single.name, 'Fuel');
      expect(
          pairing.requests.first.headers.containsKey('Authorization'), isFalse);
      expect(
          pairing.requests.last.headers['Authorization'], 'Bearer zd_dev_new');
    });

    test('a wrong code leaves the phone unpaired', () async {
      final fresh = MemoryStore();
      final pairing = FakeServer((r, b) =>
          json(400, {'message': 'That code is wrong or has expired'}));
      final service = CaptureService(fresh,
          anonymousApi: (url) => ApiClient(url, client: pairing.client));
      await expectLater(
        service.pair('https://zerodue.example', 'WRONG', 'Pixel'),
        throwsA(isA<ApiException>().having(
            (e) => e.message, 'message', contains('wrong or has expired'))),
      );
      expect(await service.session(), isNull);
    });

    test('forgets the pairing', () async {
      await capture.unpair();
      expect(await capture.session(), isNull);
      expect(await capture.needsPairing(), isFalse);
    });
  });

  group('config', () {
    test('keeps the allow-list and category buttons from the server', () async {
      server.respond = (r, b) => json(200, {
            'allowList': ['*-OTHER'],
            'quickPicks': [
              {'id': 'f', 'name': 'Fuel'}
            ]
          });
      final session = await capture.refreshConfig();
      expect(session!.allowList, ['*-OTHER']);
      expect((await capture.session())!.quickPicks.single.name, 'Fuel');
    });

    test(
        'keeps what it has when offline, and notes when this phone was removed',
        () async {
      server.respond = (r, b) => throw http.ClientException('down');
      expect(
          (await capture.refreshConfig())!.allowList, Session.defaultAllowList);
      server.respond = (r, b) => json(401, {'message': 'revoked'});
      await capture.refreshConfig();
      expect(await capture.needsPairing(), isTrue);
    });

    test('does nothing when not paired', () async {
      await capture.unpair();
      expect(await capture.refreshConfig(), isNull);
      expect(server.requests, isEmpty);
    });
  });

  group('handling a message', () {
    test('does nothing when not paired', () async {
      await capture.unpair();
      expect(await capture.handle('VM-ICICIB', bankSms, arrived),
          isA<NotPaired>());
    });

    test('drops a sender you did not allow without keeping anything', () async {
      expect(await capture.handle('AD-SHOP', bankSms, arrived), isA<Ignored>());
      expect(await capture.log(), isEmpty);
      expect(server.requests, isEmpty);
    });

    test(
        'notes why a message from your bank was skipped, without keeping its text',
        () async {
      final outcome = await capture.handle(
          'VM-ICICIB', '123456 is the OTP for Rs 450.00 at SHELL', arrived);
      expect((outcome as Ignored).reason, IgnoreReason.otp);
      final log = await capture.log();
      expect(log.single.state, 'ignored');
      expect(log.single.summary, contains('one-time password'));
      expect(jsonEncode(log.map((e) => e.toJson()).toList()),
          isNot(contains('123456')));
    });

    test('sends a payment at once and says what the server made of it',
        () async {
      final outcome = await capture.handle('VM-ICICIB', bankSms, arrived);
      expect((outcome as Delivered).result.title, '₹450 paid to SHELL');
      final sent = server.requests.single;
      expect(sent.path, '/ingest/sms');
      expect(sent.body!['senderId'], 'VM-ICICIB');
      expect(sent.body!['receivedAt'], '2026-11-05T04:40:00.000Z');
      expect(
          sent.body!['clientEventId'],
          matches(RegExp(
              r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
      expect(sent.body!['messageHash'], matches(RegExp(r'^[0-9a-f]{64}$')));
      expect(sent.body!.containsKey('rawBody'), isFalse);
      expect(jsonEncode(sent.body), isNot(contains('debited for')),
          reason: 'only the parsed fields leave the phone');
      expect(await capture.pending(), 0);
      final entry = (await capture.log()).single;
      expect(entry.state, 'sent');
      expect(entry.summary, '₹450 paid to SHELL PETROL PUMP');
    });

    test(
        'queues a payment when offline and delivers it when the server is back',
        () async {
      server.respond = (r, b) => throw http.ClientException('down');
      expect(
          await capture.handle('VM-ICICIB', bankSms, arrived), isA<Queued>());
      expect(await capture.pending(), 1);
      expect((await capture.log()).single.state, 'queued');

      server.respond = (r, b) => json(200, ingestJson());
      final report = await capture.flush(force: true);
      expect(report.sent, hasLength(1));
      expect(await capture.pending(), 0);
      expect((await capture.log()).single.state, 'sent');
    });

    test(
        'delivers an older message together with a newer one once the delay is over',
        () async {
      server.respond = (r, b) => throw http.ClientException('down');
      expect(
          await capture.handle('VM-ICICIB', bankSms, arrived), isA<Queued>());
      // a second message while the first is still waiting out its retry delay: both stay queued
      final waiting = await capture.handle(
        'VM-ICICIB',
        'Rs 20.00 debited at CHAI POINT on 05-Nov-26',
        arrived.add(const Duration(minutes: 5)),
      );
      expect(waiting, isA<Queued>());
      expect(await capture.pending(), 2);

      // the user opens the app: both go out, and each one's result is available for a notification
      server.respond = (r, b) => json(200, ingestJson());
      final report = await capture.flush(force: true);
      expect(report.sent, hasLength(2));
      expect(await capture.pending(), 0);
    });

    test('hands back an older message that goes out together with a new one',
        () async {
      var clock = DateTime.utc(2026, 11, 5, 10);
      final timed = CaptureService(
        store,
        now: () => clock,
        apiFor: (s) =>
            ApiClient(s.apiUrl, token: s.deviceToken, client: server.client),
      );
      server.respond = (r, b) => throw http.ClientException('down');
      expect(await timed.handle('VM-ICICIB', bankSms, arrived), isA<Queued>());

      clock = clock.add(const Duration(hours: 2)); // past the retry delay
      server.respond = (r, b) => json(200, ingestJson());
      final outcome = await timed.handle(
        'VM-ICICIB',
        'Rs 20.00 debited at CHAI POINT on 05-Nov-26',
        arrived.add(const Duration(minutes: 5)),
      );
      expect((outcome as Delivered).earlier, hasLength(1));
      expect(await timed.pending(), 0);
    });

    test(
        'gives the same message the same hash, and a different message a different one',
        () async {
      server.respond = (r, b) => throw http.ClientException('down');
      await capture.handle('VM-ICICIB', bankSms, arrived);
      await capture.handle(
          'VM-ICICIB', bankSms, arrived); // the same broadcast delivered twice
      await capture.handle(
          'VM-ICICIB', bankSms, arrived.add(const Duration(minutes: 1)));
      expect(await capture.pending(), 2);
    });

    test('marks a repeat of the same payment as already known', () async {
      server.respond = (r, b) => json(200, ingestJson(deduped: true));
      await capture.handle('VM-ICICIB', bankSms, arrived);
      expect((await capture.log()).single.state, 'known');
    });

    test('remembers that the phone was removed and keeps the message',
        () async {
      server.respond = (r, b) => json(401, {'message': 'revoked'});
      expect(
          await capture.handle('VM-ICICIB', bankSms, arrived), isA<Queued>());
      expect(await capture.needsPairing(), isTrue);
      expect(await capture.pending(), 1);
    });

    test('keeps only the most recent fifty lines', () async {
      server.respond = (r, b) => throw http.ClientException('down');
      for (var i = 0; i < 55; i++) {
        await capture.handle(
            'VM-ICICIB', bankSms, arrived.add(Duration(minutes: i)));
      }
      expect(await capture.log(), hasLength(CaptureService.logSize));
    });

    test('writes a summary with paise, credits and no merchant', () async {
      server.respond = (r, b) => throw http.ClientException('down');
      await capture.handle(
          'VM-ICICIB', 'Rs 10.50 credited by A FRIEND on 05-Nov-26', arrived);
      await capture.handle('VM-ICICIB', 'Rs 20 debited on 05-Nov-26',
          arrived.add(const Duration(minutes: 1)));
      expect((await capture.log()).map((e) => e.summary),
          ['₹20 paid', '₹10.50 received from A FRIEND']);
    });
  });

  group('notification plans', () {
    test('asks what type of payment, with up to three category buttons', () {
      final plan = planNotification(ingestResult())!;
      expect(plan.title, '₹450 paid to SHELL. What type of payment?');
      expect(plan.actions, {
        'cat:fuel-id': 'Fuel',
        'cat:food-id': 'Food & going out',
        'cat:card-id': 'Card'
      });
      expect(plan.quiet, isFalse);
      expect(transactionOfPayload(plan.payload),
          '11111111-1111-4111-8111-111111111111');
      expect(plan.id, greaterThanOrEqualTo(0));
      expect(plan.id, notificationId('11111111-1111-4111-8111-111111111111'));
    });

    test(
        'has nothing to say about a payment already seen, or one marked not a payment',
        () {
      expect(planNotification(ingestResult(deduped: true)), isNull);
      expect(planNotification(ingestResult(status: 'IGNORED')), isNull);
    });

    test('is quiet when the payment was categorised on arrival', () {
      final plan = planNotification(ingestResult(status: 'POSTED'))!;
      expect(plan.quiet, isTrue);
      expect(plan.actions, isEmpty);
    });

    test('offers no expense categories for money received', () {
      final plan = planNotification(ingestResult(type: 'INCOME'))!;
      expect(plan.actions, isEmpty);
      expect(plan.title, isNot(contains('What type')));
    });

    test('reads buttons and payloads, and shrugs at nonsense', () {
      expect(categoryOfAction('cat:abc'), 'abc');
      expect(categoryOfAction('open'), isNull);
      expect(actionFor('abc'), 'cat:abc');
      expect(transactionOfPayload('not json'), '');
      expect(transactionOfPayload(null), '');
      expect(transactionOfPayload('{}'), '');
    });
  });

  group('tapping a category button', () {
    final payload = jsonEncode({'t': 'txn-1'});
    Future<ActionResult> tap(String action, {String? body}) =>
        handleCategoryAction(
          store,
          action,
          body ?? payload,
          apiFor: (url, token) =>
              ApiClient(url, token: token, client: server.client),
        );

    test('sets the category', () async {
      server.respond = (r, b) => json(200, {});
      expect(await tap('cat:fuel-id'), ActionResult.done);
      expect(server.requests.single.path, '/transactions/txn-1/categorise');
      expect(
          server.requests.single.body, containsPair('categoryId', 'fuel-id'));
    });

    test('leaves it alone when someone else categorised it first', () async {
      server.respond = (r, b) => json(
          409, {'message': 'Already categorised', 'currentCategoryId': 'x'});
      expect(await tap('cat:fuel-id'), ActionResult.alreadyCategorised);
    });

    test('reports offline, and a removed phone', () async {
      server.respond = (r, b) => throw http.ClientException('down');
      expect(await tap('cat:fuel-id'), ActionResult.offline);
      server.respond = (r, b) => json(401, {'message': 'revoked'});
      expect(await tap('cat:fuel-id'), ActionResult.needsPairing);
    });

    test(
        'ignores buttons it does not know, payments it cannot identify, and an unpaired phone',
        () async {
      expect(await tap('open'), ActionResult.ignored);
      expect(await tap('cat:fuel-id', body: '{}'), ActionResult.ignored);
      await capture.unpair();
      expect(await tap('cat:fuel-id'), ActionResult.needsPairing);
    });

    test('passes on a failure it does not understand', () async {
      server.respond = (r, b) => json(500, {'message': 'oops'});
      await expectLater(tap('cat:fuel-id'), throwsA(isA<ApiException>()));
    });

    test(
        'uses the real client when none is injected (the unpaired case never reaches the network)',
        () async {
      await capture.unpair();
      expect(await handleCategoryAction(store, 'cat:x', payload),
          ActionResult.needsPairing);
    });
  });

  group('session store', () {
    test('treats damaged data as not paired', () async {
      await store.write('session', '{not json');
      expect(await SessionStore(store).load(), isNull);
    });

    test('makes a fresh salt each time', () {
      expect(SessionStore.newSalt(), hasLength(32));
      expect(SessionStore.newSalt(), isNot(SessionStore.newSalt()));
    });
  });
}
