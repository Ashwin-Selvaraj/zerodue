import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../core/notification_plan.dart';

/// Shows the "what type of payment?" notification and its category buttons.
class NotificationService {
  NotificationService._();
  static final _plugin = FlutterLocalNotificationsPlugin();
  static var _ready = false;

  static const _channelId = 'payments';
  static const _quietChannelId = 'payments_quiet';

  /// Safe to call more than once. The background callback runs in its own isolate and calls this too.
  static Future<void> init({
    DidReceiveNotificationResponseCallback? onTap,
    DidReceiveBackgroundNotificationResponseCallback? onBackgroundAction,
  }) async {
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
      onDidReceiveNotificationResponse: onTap,
      onDidReceiveBackgroundNotificationResponse: onBackgroundAction,
    );
    _ready = true;
  }

  static Future<void> show(NotificationPlan plan) async {
    if (!_ready) await init();
    await _plugin.show(
      id: plan.id,
      title: plan.title,
      body: plan.body,
      payload: plan.payload,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          plan.quiet ? _quietChannelId : _channelId,
          plan.quiet ? 'Automatic payments' : 'Payments to categorise',
          channelDescription: plan.quiet
              ? 'Payments that were categorised for you'
              : 'Asks what type of payment each captured message was',
          importance: plan.quiet ? Importance.low : Importance.high,
          priority: plan.quiet ? Priority.low : Priority.high,
          autoCancel: true,
          category: AndroidNotificationCategory.status,
          actions: [
            for (final entry in plan.actions.entries)
              AndroidNotificationAction(entry.key, entry.value,
                  cancelNotification: true),
          ],
        ),
      ),
    );
  }

  /// A short plain note, e.g. "Already categorised as Food".
  static Future<void> note(String title, String body) async {
    if (!_ready) await init();
    await _plugin.show(
      id: title.hashCode & 0x7fffffff,
      title: title,
      body: body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          _quietChannelId,
          'Automatic payments',
          importance: Importance.low,
          priority: Priority.low,
          timeoutAfter: 8000,
        ),
      ),
    );
  }

  static Future<bool> allowed() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    return await android?.areNotificationsEnabled() ?? false;
  }
}
