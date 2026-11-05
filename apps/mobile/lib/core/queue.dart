import 'dart:convert';
import 'dart:math';

import 'api.dart';
import 'models.dart';
import 'store.dart';

class QueueItem {
  QueueItem(this.event, {this.attempts = 0, this.nextAttemptAt = 0});
  final PaymentEvent event;
  int attempts;

  /// Milliseconds since the epoch; not before this.
  int nextAttemptAt;

  Map<String, Object> toJson() => {
        'event': event.toJson(),
        'attempts': attempts,
        'nextAttemptAt': nextAttemptAt,
      };

  factory QueueItem.fromJson(Map<String, Object?> json) => QueueItem(
        PaymentEvent.fromJson((json['event']! as Map).cast<String, Object?>()),
        attempts: json['attempts']! as int,
        nextAttemptAt: json['nextAttemptAt']! as int,
      );
}

class FlushReport {
  FlushReport({
    this.sent = const [],
    this.dropped = const [],
    this.remaining = 0,
    this.revoked = false,
    this.offline = false,
  });

  /// Delivered, with what the server said about each.
  final List<({PaymentEvent event, IngestResult result})> sent;

  /// Refused as invalid (will never succeed), so removed.
  final List<PaymentEvent> dropped;
  final int remaining;

  /// This phone's token was rejected: it must be paired again. The queue is kept.
  final bool revoked;
  final bool offline;
}

/// Payment messages waiting to reach the server. They survive being offline and are retried with a
/// growing delay (up to an hour), so a flat battery or a dead zone loses nothing.
class EventQueue {
  EventQueue(this._store, {DateTime Function()? now, Random? random})
      : _now = now ?? DateTime.now,
        _random = random ?? Random();

  final KeyValueStore _store;
  final DateTime Function() _now;
  final Random _random;
  static const _key = 'queue';
  static const baseDelay = Duration(seconds: 30);
  static const maxDelay = Duration(hours: 1);

  Future<List<QueueItem>> items() async {
    final raw = await _store.read(_key);
    if (raw == null) return [];
    try {
      return (jsonDecode(raw) as List<Object?>)
          .map((j) => QueueItem.fromJson((j! as Map).cast<String, Object?>()))
          .toList();
    } on Object {
      return [];
    }
  }

  Future<void> _save(List<QueueItem> items) =>
      _store.write(_key, jsonEncode(items.map((i) => i.toJson()).toList()));

  Future<void> add(PaymentEvent event) async {
    final items = await this.items();
    if (items.any((i) => i.event.messageHash == event.messageHash)) {
      return; // the same message twice
    }
    items.add(QueueItem(event));
    await _save(items);
  }

  /// The delay after `attempts` failures: 30s, 1m, 2m... up to an hour, then up to half of that again
  /// off, so many phones do not all retry together.
  Duration delayFor(int attempts) {
    final exponential = baseDelay.inMilliseconds * pow(2, attempts - 1);
    final capped = min(exponential, maxDelay.inMilliseconds.toDouble());
    return Duration(
        milliseconds: (capped * (0.5 + _random.nextDouble() / 2)).round());
  }

  /// Sends what is due, oldest first. Stops at the first sign the server is unreachable or has
  /// turned this phone away. `force` ignores the retry delay (when the user opens the app).
  Future<FlushReport> flush(ApiClient api, {bool force = false}) async {
    final items = await this.items();
    final sent = <({PaymentEvent event, IngestResult result})>[];
    final dropped = <PaymentEvent>[];
    final keep = <QueueItem>[];
    var revoked = false;
    var offline = false;
    var stopped = false;

    for (final item in items) {
      if (stopped) {
        keep.add(item);
        continue;
      }
      if (!force && item.nextAttemptAt > _now().millisecondsSinceEpoch) {
        // this one is still waiting out a failure: the server is probably unreachable, so leave the rest
        stopped = true;
        keep.add(item);
        continue;
      }
      try {
        sent.add((event: item.event, result: await api.ingest(item.event)));
      } on OfflineException {
        offline = stopped = true;
        _fail(item);
        keep.add(item);
      } on ApiException catch (e) {
        if (e.revoked) {
          revoked = stopped = true;
          keep.add(item);
        } else if (e.status == 429 || e.status >= 500) {
          stopped = true;
          _fail(item);
          keep.add(item);
        } else {
          dropped.add(item.event); // the server will never accept this one
        }
      }
    }
    await _save(keep);
    return FlushReport(
      sent: sent,
      dropped: dropped,
      remaining: keep.length,
      revoked: revoked,
      offline: offline,
    );
  }

  void _fail(QueueItem item) {
    item.attempts++;
    item.nextAttemptAt =
        _now().add(delayFor(item.attempts)).millisecondsSinceEpoch;
  }
}
