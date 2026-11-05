import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:zerodue/core/models.dart';
import 'package:zerodue/core/queue.dart';
import 'package:zerodue/core/sms_parser.dart';
import 'package:zerodue/core/store.dart';

import 'support.dart';

PaymentEvent event(String hash) => PaymentEvent(
      clientEventId: 'id-$hash',
      senderId: 'VM-ICICIB',
      receivedAt: '2026-11-05T04:40:00.000Z',
      messageHash: hash,
      parsed: parseSms('Rs 450.00 debited at SHELL').payment!,
    );

void main() {
  late MemoryStore store;
  late DateTime clock;
  late EventQueue queue;

  setUp(() {
    store = MemoryStore();
    clock = DateTime.utc(2026, 11, 5, 10);
    queue = EventQueue(store, now: () => clock, random: Random(1));
  });

  test('keeps events in order and ignores the same message twice', () async {
    await queue.add(event('a'));
    await queue.add(event('b'));
    await queue.add(event('a'));
    expect((await queue.items()).map((i) => i.event.messageHash), ['a', 'b']);
  });

  test('survives a damaged store by starting empty', () async {
    await store.write('queue', 'not json');
    expect(await queue.items(), isEmpty);
  });

  test('sends everything and empties the queue', () async {
    await queue.add(event('a'));
    await queue.add(event('b'));
    final server = FakeServer((r, b) => json(200, ingestJson()));
    final report = await queue.flush(server.api());
    expect(report.sent.map((s) => s.event.messageHash), ['a', 'b']);
    expect(report.remaining, 0);
    expect(report.offline, isFalse);
    expect(await queue.items(), isEmpty);
  });

  test(
      'keeps events when offline, waits before retrying, and stops at the first failure',
      () async {
    await queue.add(event('a'));
    await queue.add(event('b'));
    final server = FakeServer((r, b) => throw http.ClientException('down'));
    final report = await queue.flush(server.api());
    expect(report.offline, isTrue);
    expect(report.remaining, 2);
    expect(server.requests, hasLength(1)); // did not hammer the second one
    final items = await queue.items();
    expect(items[0].attempts, 1);
    expect(items[0].nextAttemptAt, greaterThan(clock.millisecondsSinceEpoch));
    expect(items[1].attempts, 0);

    // too soon: nothing is tried
    server.requests.clear();
    await queue.flush(server.api());
    expect(server.requests, isEmpty);

    // opening the app forces it
    server.respond = (r, b) => json(200, ingestJson());
    final forced = await queue.flush(server.api(), force: true);
    expect(forced.sent, hasLength(2));
  });

  test('retries once the delay has passed', () async {
    await queue.add(event('a'));
    final server = FakeServer((r, b) => throw http.ClientException('down'));
    await queue.flush(server.api());
    clock = clock.add(const Duration(hours: 2));
    server.respond = (r, b) => json(200, ingestJson());
    expect((await queue.flush(server.api())).sent, hasLength(1));
  });

  test(
      'the delay doubles, stays between half and the full value, and never passes an hour',
      () {
    for (var attempts = 1; attempts <= 20; attempts++) {
      final delay = queue.delayFor(attempts);
      final full = (30 * 1000 * pow(2, attempts - 1)).clamp(0, 3600 * 1000);
      expect(delay.inMilliseconds, inInclusiveRange(full * 0.5 - 1, full + 1));
      expect(delay, lessThanOrEqualTo(const Duration(hours: 1)));
    }
  });

  test('stops and keeps everything when the server turns this phone away',
      () async {
    await queue.add(event('a'));
    await queue.add(event('b'));
    final server = FakeServer((r, b) => json(401, {'message': 'revoked'}));
    final report = await queue.flush(server.api());
    expect(report.revoked, isTrue);
    expect(report.remaining, 2);
    expect(server.requests, hasLength(1));
    expect((await queue.items()).first.attempts, 0); // not the message's fault
  });

  test('backs off on a busy or broken server, and keeps the events', () async {
    await queue.add(event('a'));
    for (final status in [429, 500, 503]) {
      final server = FakeServer((r, b) => json(status, {'message': 'busy'}));
      final report = await queue.flush(server.api(), force: true);
      expect(report.remaining, 1, reason: '$status');
      expect(report.offline, isFalse);
    }
    expect((await queue.items()).single.attempts, 3);
  });

  test('drops a message the server will never accept and carries on', () async {
    await queue.add(event('bad'));
    await queue.add(event('good'));
    final server = FakeServer((r, b) => b!['messageHash'] == 'bad'
        ? json(400, {'message': 'invalid'})
        : json(200, ingestJson()));
    final report = await queue.flush(server.api());
    expect(report.dropped.map((e) => e.messageHash), ['bad']);
    expect(report.sent.map((s) => s.event.messageHash), ['good']);
    expect(report.remaining, 0);
  });
}
