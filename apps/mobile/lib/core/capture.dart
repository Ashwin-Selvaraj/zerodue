import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

import 'api.dart';
import 'models.dart';
import 'queue.dart';
import 'session_store.dart';
import 'sms_parser.dart';
import 'store.dart';

sealed class CaptureOutcome {
  const CaptureOutcome();
}

/// The phone has not been paired yet.
class NotPaired extends CaptureOutcome {
  const NotPaired();
}

/// Not a payment (or not from a sender you allow): nothing was kept.
class Ignored extends CaptureOutcome {
  const Ignored(this.reason);
  final IgnoreReason reason;
}

/// Sent, and the server said what it made of it. [earlier] are older messages that went out in the
/// same attempt (the phone had been offline), so they get their notifications now.
class Delivered extends CaptureOutcome {
  const Delivered(this.result, [this.earlier = const []]);
  final IngestResult result;
  final List<IngestResult> earlier;
}

/// Read, but not sent yet (offline); it is in the queue.
class Queued extends CaptureOutcome {
  const Queued([this.earlier = const []]);
  final List<IngestResult> earlier;
}

/// One line in the "recent captures" list. The message text itself is never kept.
class CaptureLogEntry {
  const CaptureLogEntry(
      {required this.at,
      required this.sender,
      required this.summary,
      required this.state});

  final int at;
  final String sender;
  final String summary;

  /// `queued`, `sent`, `known` (the same payment as an earlier message) or `ignored`.
  final String state;

  Map<String, Object> toJson() =>
      {'at': at, 'sender': sender, 'summary': summary, 'state': state};
  factory CaptureLogEntry.fromJson(Map<String, Object?> json) =>
      CaptureLogEntry(
        at: json['at']! as int,
        sender: json['sender']! as String,
        summary: json['summary']! as String,
        state: json['state']! as String,
      );
}

/// Reads each incoming message, keeps the payments, and gets them to the server.
class CaptureService {
  CaptureService(
    this._store, {
    ApiClient Function(Session session)? apiFor,
    ApiClient Function(String apiUrl)? anonymousApi,
    DateTime Function()? now,
    Random? random,
  })  : _sessions = SessionStore(_store),
        _queue = EventQueue(_store, now: now, random: random),
        _apiFor = apiFor ?? ((s) => ApiClient(s.apiUrl, token: s.deviceToken)),
        _anonymous = anonymousApi ?? ApiClient.new,
        _now = now ?? DateTime.now;

  final KeyValueStore _store;
  final SessionStore _sessions;
  final EventQueue _queue;
  final ApiClient Function(Session) _apiFor;
  final ApiClient Function(String) _anonymous;
  final DateTime Function() _now;

  static const _logKey = 'captureLog';
  static const _revokedKey = 'revoked';
  static const logSize = 50;

  Future<Session?> session() => _sessions.load();
  Future<int> pending() async => (await _queue.items()).length;

  /// True once the server has turned this phone's token away; pair again to continue.
  Future<bool> needsPairing() async => await _store.read(_revokedKey) == 'true';

  Future<void> pair(String apiUrl, String code, String deviceName) async {
    final url = ApiClient.clean(apiUrl);
    final paired = await _anonymous(url).pair(code, deviceName);
    await _sessions.save(
      Session(
        apiUrl: url,
        deviceToken: paired.deviceToken,
        deviceId: paired.deviceId,
        salt: SessionStore.newSalt(),
      ),
    );
    await _store.remove(_revokedKey);
    await refreshConfig();
  }

  Future<void> unpair() async {
    await _sessions.clear();
    await _store.remove(_revokedKey);
  }

  /// Fetches the sender allow-list and category buttons. Quietly does nothing when offline.
  Future<Session?> refreshConfig() async {
    final session = await _sessions.load();
    if (session == null) return null;
    try {
      final config = await _apiFor(session).config();
      final updated = session.copyWith(
          allowList: config.allowList, quickPicks: config.quickPicks);
      await _sessions.save(updated);
      return updated;
    } on OfflineException {
      return session;
    } on ApiException catch (e) {
      if (e.revoked) await _store.write(_revokedKey, 'true');
      return session;
    }
  }

  String _hash(
          Session session, String sender, String body, DateTime receivedAt) =>
      sha256
          .convert(utf8.encode(
              '${session.salt}|$sender|${receivedAt.millisecondsSinceEpoch}|$body'))
          .toString();

  static String _newId(Random random) {
    final b = List<int>.generate(16, (_) => random.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }

  /// A message arrived. Reads it, queues it if it is a payment, and tries to send at once.
  Future<CaptureOutcome> handle(
      String sender, String body, DateTime receivedAt) async {
    final session = await _sessions.load();
    if (session == null) return const NotPaired();

    final reading = readSms(sender, body, session.allowList);
    final payment = reading.payment;
    if (payment == null) {
      // messages from other senders are not recorded at all; skipped ones from yours are, so you can see why
      if (reading.ignored != IgnoreReason.notAllowedSender) {
        await _log(sender, reading.ignored!.explanation, 'ignored');
      }
      return Ignored(reading.ignored!);
    }

    final event = PaymentEvent(
      clientEventId: _newId(Random.secure()),
      senderId: sender,
      receivedAt: receivedAt.toUtc().toIso8601String(),
      messageHash: _hash(session, sender, body, receivedAt),
      parsed: payment,
    );
    await _queue.add(event);
    await _log(sender, _summary(payment), 'queued', hash: event.messageHash);

    final report = await flush();
    final earlier = [
      for (final sent in report.sent)
        if (sent.event.messageHash != event.messageHash) sent.result,
    ];
    for (final sent in report.sent) {
      if (sent.event.messageHash == event.messageHash) {
        return Delivered(sent.result, earlier);
      }
    }
    return Queued(earlier);
  }

  /// Sends what is waiting. `force` ignores retry delays (the user opened the app).
  Future<FlushReport> flush({bool force = false}) async {
    final session = await _sessions.load();
    if (session == null) return FlushReport();
    final report = await _queue.flush(_apiFor(session), force: force);
    if (report.revoked) await _store.write(_revokedKey, 'true');
    for (final sent in report.sent) {
      await _markLog(
          sent.event.messageHash, sent.result.deduped ? 'known' : 'sent');
    }
    return report;
  }

  static String _summary(ParsedPayment p) {
    final rupees = p.amountPaise ~/ 100;
    final paise = p.amountPaise % 100;
    final amount =
        '₹$rupees${paise == 0 ? '' : '.${paise.toString().padLeft(2, '0')}'}';
    final who = p.merchant ?? p.vpa;
    return p.direction == 'DEBIT'
        ? '$amount paid${who != null ? ' to $who' : ''}'
        : '$amount received${who != null ? ' from $who' : ''}';
  }

  // The log is keyed by message hash so a later "sent" can find its line, without keeping the text.
  Future<List<Map<String, Object?>>> _rawLog() async {
    final raw = await _store.read(_logKey);
    if (raw == null) return [];
    try {
      return (jsonDecode(raw) as List<Object?>)
          .map((e) => (e! as Map).cast<String, Object?>())
          .toList();
    } on Object {
      return [];
    }
  }

  Future<void> _log(String sender, String summary, String state,
      {String? hash}) async {
    final entries = await _rawLog();
    entries.insert(0, {
      'at': _now().millisecondsSinceEpoch,
      'sender': sender,
      'summary': summary,
      'state': state,
      'hash': hash ?? '',
    });
    await _store.write(_logKey, jsonEncode(entries.take(logSize).toList()));
  }

  Future<void> _markLog(String hash, String state) async {
    final entries = await _rawLog();
    for (final e in entries) {
      if (e['hash'] == hash) {
        e['state'] = state;
        break;
      }
    }
    await _store.write(_logKey, jsonEncode(entries));
  }

  // ───────────────────────── the inbox, from the phone ─────────────────────────

  Future<ApiClient?> _api() async {
    final session = await _sessions.load();
    return session == null ? null : _apiFor(session);
  }

  /// Captured payments still waiting for a category; empty when not paired.
  Future<List<Map<String, Object?>>> inbox() async =>
      await (await _api())?.uncategorised() ?? [];

  Future<void> categorise(String transactionId, String categoryId,
      {bool createRule = false}) async {
    await (await _api())
        ?.categorise(transactionId, categoryId, createRule: createRule);
  }

  Future<void> ignore(String transactionId) async {
    await (await _api())?.ignore(transactionId);
  }

  Future<List<CaptureLogEntry>> log() async =>
      (await _rawLog()).map(CaptureLogEntry.fromJson).toList();
}
