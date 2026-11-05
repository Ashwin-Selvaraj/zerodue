import '../core/notification_plan.dart';

/// A message the Kotlin side caught and kept for the app to read.
class RawSms {
  const RawSms(this.sender, this.body, this.receivedAt);
  final String sender;
  final String body;
  final DateTime receivedAt;
}

class DevicePermissions {
  const DevicePermissions({
    this.sms = false,
    this.notifications = false,
    this.batteryExempt = false,
  });
  final bool sms;
  final bool notifications;

  /// Allowed to keep running in the background, which Android needs for reading a message when the
  /// app is closed.
  final bool batteryExempt;

  bool get ready => sms && notifications && batteryExempt;
}

/// Everything the app needs from the phone itself, so the rest can be tested without one.
abstract class DeviceServices {
  Future<DevicePermissions> permissions();
  Future<void> requestPermissions();

  /// Tells the native receiver which senders to keep; it drops everything else without reading it.
  Future<void> setAllowList(List<String> patterns);

  /// Messages the native side kept while the app was not running. Empties them.
  Future<List<RawSms>> takePending();

  Future<void> notify(NotificationPlan plan);
}
