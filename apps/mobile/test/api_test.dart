import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zerodue/core/api.dart';
import 'package:zerodue/core/models.dart';
import 'package:zerodue/core/sms_parser.dart';

import 'support.dart';

void main() {
  group('ApiClient', () {
    test('tidies the address', () {
      expect(ApiClient.clean(' https://a.example/// '), 'https://a.example');
      expect(ApiClient.clean('a.example'), 'https://a.example');
      expect(ApiClient.clean('http://192.168.1.5:4000/'),
          'http://192.168.1.5:4000');
    });

    test('pairs without a token and returns the device token', () async {
      final server = FakeServer(
          (r, b) => json(200, {'deviceId': 'd1', 'deviceToken': 'zd_dev_x'}));
      final paired = await server.api(token: null).pair(' ab12cd34 ', 'Pixel');
      expect(paired.deviceToken, 'zd_dev_x');
      final sent = server.requests.single;
      expect(sent.path, '/devices/pair');
      expect(sent.body, {'code': 'ab12cd34', 'deviceName': 'Pixel'});
      expect(sent.headers.containsKey('Authorization'), isFalse);
    });

    test('sends the token on every other call', () async {
      final server = FakeServer((r, b) => json(200, {
            'allowList': ['*-X'],
            'quickPicks': []
          }));
      await server.api().config();
      expect(server.requests.single.headers['Authorization'],
          'Bearer zd_dev_test');
    });

    test('reads the config', () async {
      final server = FakeServer(
        (r, b) => json(200, {
          'allowList': ['*-ICICIB'],
          'quickPicks': [
            {'id': 'a', 'name': 'Fuel'},
          ],
        }),
      );
      final config = await server.api().config();
      expect(config.allowList, ['*-ICICIB']);
      expect(config.quickPicks.single.name, 'Fuel');
    });

    test('sends a captured payment and reads the answer', () async {
      final server = FakeServer((r, b) => json(200, ingestJson()));
      final event = PaymentEvent(
        clientEventId: 'e1',
        senderId: 'VM-ICICIB',
        receivedAt: '2026-11-05T04:40:00.000Z',
        messageHash: 'abcdef012345',
        parsed: parseSms('Rs 450.00 debited at SHELL').payment!,
      );
      final result = await server.api().ingest(event);
      expect(result.title, '₹450 paid to SHELL');
      expect(result.quickPicks.map((q) => q.name),
          ['Fuel', 'Food & going out', 'Card', 'Misc']);
      expect(server.requests.single.body!['parsed'],
          containsPair('amountPaise', 45000));
      expect(server.requests.single.body, isNot(contains('rawBody')));
    });

    test('categorises and ignores', () async {
      final server = FakeServer((r, b) => json(200, {}));
      await server.api().categorise('t1', 'c1', createRule: true);
      await server.api().ignore('t1');
      expect(server.requests[0].path, '/transactions/t1/categorise');
      expect(server.requests[0].body,
          {'categoryId': 'c1', 'via': 'FLUTTER', 'createRule': true});
      expect(server.requests[1].path, '/transactions/t1/ignore');
    });

    test('lists captured payments waiting for a category', () async {
      final server = FakeServer(
        (r, b) => json(200, {
          'items': [
            {'id': 't1', 'amountPaise': 45000},
          ],
          'count': 1,
        }),
      );
      expect((await server.api().uncategorised()).single['id'], 't1');
    });

    test('reports the server’s message, and the category that won a 409',
        () async {
      final server = FakeServer(
        (r, b) => json(409, {
          'statusCode': 409,
          'message': 'Already categorised',
          'currentCategoryId': 'c9'
        }),
      );
      await expectLater(
        server.api().categorise('t1', 'c1'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 409)
              .having((e) => e.message, 'message', 'Already categorised')
              .having((e) => e.currentCategoryId, 'current', 'c9')
              .having((e) => e.revoked, 'revoked', isFalse),
        ),
      );
    });

    test('knows when this phone has been removed', () async {
      final server = FakeServer(
          (r, b) => json(401, {'message': 'Unknown or revoked device'}));
      await expectLater(
          server.api().config(),
          throwsA(
              isA<ApiException>().having((e) => e.revoked, 'revoked', isTrue)));
    });

    test('copes with an error that is not JSON', () async {
      final server =
          FakeServer((r, b) => http.Response('<html>Bad gateway</html>', 502));
      await expectLater(
        server.api().config(),
        throwsA(isA<ApiException>()
            .having((e) => e.message, 'message', 'Request failed (502)')),
      );
    });

    test('says offline when the server cannot be reached or is too slow',
        () async {
      final down = ApiClient('https://x',
          token: 't',
          client:
              MockClient((r) async => throw http.ClientException('no route')));
      await expectLater(down.config(), throwsA(isA<OfflineException>()));
      final slow = ApiClient('https://x',
          token: 't',
          client: MockClient((r) async => throw TimeoutException('slow')));
      await expectLater(slow.config(), throwsA(isA<OfflineException>()));
      expect(OfflineException().toString(), 'OfflineException');
    });
  });

  group('models', () {
    test('a session survives JSON, and fills in what an old one lacks', () {
      const session = Session(
        apiUrl: 'https://a',
        deviceToken: 't',
        deviceId: 'd',
        salt: 's',
        allowList: ['*-X'],
        quickPicks: [QuickPick('1', 'Fuel')],
      );
      final again = Session.fromJson(session.toJson());
      expect(again.allowList, ['*-X']);
      expect(again.quickPicks.single.name, 'Fuel');
      final minimal = Session.fromJson(
          {'apiUrl': 'a', 'deviceToken': 't', 'deviceId': 'd', 'salt': 's'});
      expect(minimal.allowList, Session.defaultAllowList);
      expect(minimal.quickPicks, isEmpty);
      expect(session.copyWith().allowList, ['*-X']);
    });
  });
}
