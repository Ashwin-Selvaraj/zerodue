import 'dart:convert';
import 'dart:math';

import 'models.dart';
import 'store.dart';

/// Keeps the pairing on the phone.
class SessionStore {
  SessionStore(this._store);
  final KeyValueStore _store;
  static const _key = 'session';

  Future<Session?> load() async {
    final raw = await _store.read(_key);
    if (raw == null) return null;
    try {
      return Session.fromJson((jsonDecode(raw) as Map).cast<String, Object?>());
    } on Object {
      return null; // unreadable: behave as not paired rather than crash a background job
    }
  }

  Future<void> save(Session session) =>
      _store.write(_key, jsonEncode(session.toJson()));

  Future<void> clear() => _store.remove(_key);

  /// A random value for [Session.salt].
  static String newSalt([Random? random]) {
    final r = random ?? Random.secure();
    return List.generate(
        16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }
}
