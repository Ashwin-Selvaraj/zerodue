import 'package:flutter/services.dart';

import 'device_services.dart';

/// The channel to the Kotlin receiver. Used by the app and by the headless engine the receiver starts.
class NativeBridge {
  const NativeBridge();
  static const _channel = MethodChannel('zerodue/ingest');

  Future<List<RawSms>> take() async {
    final raw =
        await _channel.invokeListMethod<Map<Object?, Object?>>('take') ??
            const [];
    return [
      for (final m in raw)
        RawSms(
          m['sender']! as String,
          m['body']! as String,
          DateTime.fromMillisecondsSinceEpoch(m['receivedAt']! as int),
        ),
    ];
  }

  Future<void> setAllowList(List<String> patterns) =>
      _channel.invokeMethod('setAllowList', patterns);

  /// Tells the service it can stop: the messages have been handled.
  Future<void> done() => _channel.invokeMethod('done');
}
