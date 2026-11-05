import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:zerodue/app_controller.dart';
import 'package:zerodue/core/api.dart';
import 'package:zerodue/core/capture.dart';
import 'package:zerodue/core/format.dart';
import 'package:zerodue/core/models.dart';
import 'package:zerodue/core/notification_plan.dart';
import 'package:zerodue/core/session_store.dart';
import 'package:zerodue/core/store.dart';
import 'package:zerodue/platform/device_services.dart';
import 'package:zerodue/ui/home_screen.dart';
import 'package:zerodue/ui/pair_screen.dart';

import 'support.dart';

class FakeDevice implements DeviceServices {
  DevicePermissions state = const DevicePermissions();
  List<RawSms> kept = [];
  List<String> allowList = [];
  final shown = <NotificationPlan>[];
  var asked = 0;

  @override
  Future<DevicePermissions> permissions() async => state;

  @override
  Future<void> requestPermissions() async {
    asked++;
    state = const DevicePermissions(
        sms: true, notifications: true, batteryExempt: true);
  }

  @override
  Future<void> setAllowList(List<String> patterns) async =>
      allowList = patterns;

  @override
  Future<List<RawSms>> takePending() async {
    final out = kept;
    kept = [];
    return out;
  }

  @override
  Future<void> notify(NotificationPlan plan) async => shown.add(plan);
}

const bankSms =
    'ICICI Bank Acct XX123 debited for Rs 450.00 on 05-Nov-26; SHELL PETROL PUMP credited. UPI:312345678901.';

void main() {
  late MemoryStore store;
  late FakeServer server;
  late FakeDevice device;
  late AppController controller;

  AppController build() => AppController(
        CaptureService(
          store,
          anonymousApi: (url) => ApiClient(url, client: server.client),
          apiFor: (s) =>
              ApiClient(s.apiUrl, token: s.deviceToken, client: server.client),
        ),
        device,
      );

  Future<void> pairDirectly() async {
    await SessionStore(store).save(
      const Session(
        apiUrl: 'https://zerodue.example',
        deviceToken: 'zd_dev_test',
        deviceId: 'd1',
        salt: 'salt',
        quickPicks: [
          QuickPick('fuel-id', 'Fuel'),
          QuickPick('food-id', 'Food & going out')
        ],
      ),
    );
  }

  /// The home screen, rebuilt whenever the controller changes, as the real app does.
  Widget homeApp() => MaterialApp(
        home: ListenableBuilder(
          listenable: controller,
          builder: (context, _) => HomeScreen(controller: controller),
        ),
      );

  http.Response standard(http.BaseRequest r, Map<String, Object?>? b) =>
      switch (r.url.path) {
        '/devices/pair' =>
          json(200, {'deviceId': 'd9', 'deviceToken': 'zd_dev_new'}),
        '/ingest/config' => json(200, {
            'allowList': ['*-ICICIB'],
            'quickPicks': [
              {'id': 'fuel-id', 'name': 'Fuel'},
              {'id': 'food-id', 'name': 'Food & going out'},
            ],
          }),
        '/ingest/sms' => json(200, ingestJson()),
        '/transactions/uncategorised' => json(200, {
            'count': 1,
            'items': [
              {
                'id': 't1',
                'amountPaise': 12930000,
                'merchant': 'SHELL',
                'type': 'EXPENSE'
              },
              {
                'id': 't2',
                'amountPaise': 50000,
                'vpa': 'a@b',
                'type': 'INCOME'
              },
            ],
          }),
        _ => json(200, {}),
      };

  setUp(() {
    store = MemoryStore();
    server = FakeServer(standard);
    device = FakeDevice();
    controller = build();
  });

  group('rupee format', () {
    test('uses Indian digit grouping', () {
      expect(formatRupees(0), '₹0');
      expect(formatRupees(45000), '₹450');
      expect(formatRupees(123456), '₹1,234.56');
      expect(formatRupees(12930000), '₹1,29,300');
      expect(formatRupees(100000000), '₹10,00,000');
      expect(formatRupees(-50), '-₹0.50');
    });
  });

  group('AppController', () {
    test('starts unpaired', () async {
      await controller.load();
      expect(controller.paired, isFalse);
      expect(controller.loading, isFalse);
    });

    test('pairs, then loads the allow-list into the receiver', () async {
      expect(await controller.pair('zerodue.example', 'ABCD1234', 'Pixel'),
          isTrue);
      expect(controller.paired, isTrue);
      expect(device.allowList, ['*-ICICIB']);
    });

    test('says what went wrong when pairing fails', () async {
      server.respond =
          (r, b) => json(400, {'message': 'That code is wrong or has expired'});
      expect(
          await controller.pair('zerodue.example', 'NOPE', 'Pixel'), isFalse);
      expect(controller.error, 'That code is wrong or has expired');
      server.respond = (r, b) => throw http.ClientException('down');
      expect(
          await controller.pair('zerodue.example', 'NOPE', 'Pixel'), isFalse);
      expect(controller.error, contains('Could not reach the server'));
    });

    test(
        'reads messages kept while the app was closed, and shows the category question',
        () async {
      await pairDirectly();
      device.kept = [
        RawSms('VM-ICICIB', bankSms, DateTime.utc(2026, 11, 5, 4, 40))
      ];
      await controller.load();
      expect(device.shown.single.title, contains('What type of payment?'));
      expect(controller.log.single.state, 'sent');
      expect(device.kept, isEmpty);
    });

    test('sends what was waiting and notifies for each', () async {
      await pairDirectly();
      server.respond = (r, b) => r.url.path == '/ingest/sms'
          ? throw http.ClientException('down')
          : standard(r, b);
      device.kept = [
        RawSms('VM-ICICIB', bankSms, DateTime.utc(2026, 11, 5, 4, 40))
      ];
      await controller.load();
      expect(controller.pending, 1);
      expect(device.shown, isEmpty);

      server.respond = standard;
      await controller.sendNow();
      expect(controller.pending, 0);
      expect(device.shown, hasLength(1));
    });

    test('asks for the permissions and then shows them as granted', () async {
      await pairDirectly();
      await controller.load();
      expect(controller.permissions.ready, isFalse);
      await controller.requestPermissions();
      expect(device.asked, 1);
      expect(controller.permissions.ready, isTrue);
    });

    test('unpairing empties the receiver’s allow-list back to the default',
        () async {
      await pairDirectly();
      await controller.load();
      await controller.unpair();
      expect(controller.paired, isFalse);
      expect(device.allowList, Session.defaultAllowList);
    });

    test('inbox, categorise and ignore report problems in words', () async {
      await pairDirectly();
      expect(await controller.inbox(), hasLength(2));
      expect(await controller.categorise('t1', 'fuel-id'), isNull);
      expect(await controller.ignore('t1'), isNull);

      server.respond = (r, b) => json(409, {'message': 'Already categorised'});
      expect(await controller.categorise('t1', 'fuel-id'),
          contains('already categorised'));
      server.respond = (r, b) => json(500, {'message': 'oops'});
      expect(await controller.categorise('t1', 'fuel-id'), 'oops');
      expect(await controller.ignore('t1'), 'oops');

      server.respond = (r, b) => throw http.ClientException('down');
      expect(await controller.categorise('t1', 'fuel-id'),
          contains('No connection'));
      expect(await controller.ignore('t1'), contains('No connection'));
      await expectLater(controller.inbox(), throwsA(isA<InboxUnavailable>()));

      server.respond = (r, b) => json(401, {'message': 'revoked'});
      await expectLater(controller.inbox(), throwsA(isA<InboxUnavailable>()));
      expect(controller.needsPairing, isTrue);
    });
  });

  group('screens', () {
    testWidgets('the pairing screen pairs and shows an error when it fails',
        (tester) async {
      await tester
          .pumpWidget(MaterialApp(home: PairScreen(controller: controller)));
      expect(find.text('Pair this phone'), findsOneWidget);

      server.respond =
          (r, b) => json(400, {'message': 'That code is wrong or has expired'});
      await tester.enterText(
          find.widgetWithText(TextField, 'Server address'), 'zerodue.example');
      await tester.enterText(
          find.widgetWithText(TextField, 'Pairing code'), 'WRONG');
      await tester.tap(find.text('Pair'));
      await tester.pumpAndSettle();
      expect(find.text('That code is wrong or has expired'), findsOneWidget);
      expect(controller.paired, isFalse);

      server.respond = standard;
      await tester.tap(find.text('Pair'));
      await tester.pumpAndSettle();
      expect(controller.paired, isTrue);
    });

    testWidgets(
        'the captures tab lists what was read, what is waiting, and the setup steps',
        (tester) async {
      await pairDirectly();
      server.respond = (r, b) => r.url.path == '/ingest/sms'
          ? throw http.ClientException('down')
          : standard(r, b);
      device.kept = [
        RawSms('VM-ICICIB', bankSms, DateTime.utc(2026, 11, 5, 4, 40))
      ];
      await tester.runAsync(controller.load);
      await tester.pumpWidget(homeApp());

      expect(find.text('₹450 paid to SHELL PETROL PUMP'), findsOneWidget);
      expect(find.textContaining('Waiting to send'), findsOneWidget);
      expect(find.text('1 waiting to send'), findsOneWidget);
      expect(find.text('Allowed to read bank messages'), findsOneWidget);
      await tester.tap(find.text('Allow'));
      await tester.pumpAndSettle();
      expect(device.asked, 1);
      expect(find.text('Allow'), findsNothing);
    });

    testWidgets('shows a banner when this phone was removed', (tester) async {
      await pairDirectly();
      server.respond = (r, b) => json(401, {'message': 'revoked'});
      await tester.runAsync(controller.load);
      await tester.pumpWidget(homeApp());
      expect(find.text('This phone was removed'), findsOneWidget);
    });

    testWidgets('the test tab shows how a pasted message is read',
        (tester) async {
      await pairDirectly();
      await tester.runAsync(controller.load);
      await tester.pumpWidget(homeApp());
      await tester.tap(find.text('Test'));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.widgetWithText(TextField, 'Paste a bank message'), bankSms);
      await tester.tap(find.text('See how it is read'));
      await tester.pumpAndSettle();
      expect(find.text('₹450'), findsOneWidget);
      expect(find.text('SHELL PETROL PUMP'), findsOneWidget);
      expect(find.text('…123'), findsOneWidget);

      await tester.enterText(
          find.widgetWithText(TextField, 'Sender, e.g. VM-ICICIB (optional)'),
          'AD-SHOP');
      await tester.tap(find.text('See how it is read'));
      await tester.pumpAndSettle();
      expect(find.textContaining('not on your allow-list'), findsOneWidget);
    });

    testWidgets('the inbox shows waiting payments and categorises with one tap',
        (tester) async {
      await pairDirectly();
      await tester.runAsync(controller.load);
      await tester.pumpWidget(homeApp());
      await tester.tap(find.text('Inbox'));
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pumpAndSettle();

      expect(find.text('₹1,29,300 SHELL'), findsOneWidget);
      expect(find.textContaining('Money received'), findsOneWidget);
      server.requests.clear();
      await tester.tap(find.widgetWithText(ActionChip, 'Fuel'));
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pumpAndSettle();
      expect(
          server.requests.any((r) => r.path == '/transactions/t1/categorise'),
          isTrue);
    });

    testWidgets('the inbox says so when offline', (tester) async {
      await pairDirectly();
      await tester.runAsync(controller.load);
      server.respond = (r, b) => throw http.ClientException('down');
      await tester.pumpWidget(homeApp());
      await tester.tap(find.text('Inbox'));
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pumpAndSettle();
      expect(find.text('You are offline.'), findsOneWidget);
    });
  });
}
