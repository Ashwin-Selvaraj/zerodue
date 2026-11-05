import 'package:shared_preferences/shared_preferences.dart';

/// A tiny key/value store, so the app's logic can be tested without a phone.
abstract class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> remove(String key);
}

class MemoryStore implements KeyValueStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> remove(String key) async => values.remove(key);
}

/// Backed by the phone's shared preferences. Safe to use from the background engine too.
class PrefsStore implements KeyValueStore {
  PrefsStore(this._prefs);
  final SharedPreferences _prefs;

  static Future<PrefsStore> open() async {
    final prefs = await SharedPreferences.getInstance();
    // the app and the background engine are separate isolates: always read what the other wrote
    await prefs.reload();
    return PrefsStore(prefs);
  }

  @override
  Future<String?> read(String key) async => _prefs.getString(key);

  @override
  Future<void> write(String key, String value) async {
    await _prefs.setString(key, value);
  }

  @override
  Future<void> remove(String key) async {
    await _prefs.remove(key);
  }
}
