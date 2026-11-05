import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'core/capture.dart';
import 'core/notification_action.dart';
import 'core/notification_plan.dart';
import 'core/store.dart';
import 'platform/native_bridge.dart';
import 'platform/notifications.dart';

/// Runs in the headless engine the Kotlin service starts when a bank message arrives: reads what the
/// receiver kept, sends the payments, shows the notification, then tells the service it can stop.
Future<void> runIngestBackground() async {
  WidgetsFlutterBinding.ensureInitialized();
  const bridge = NativeBridge();
  try {
    final store = await PrefsStore.open();
    await NotificationService.init(onBackgroundAction: notificationAction);
    final capture = CaptureService(store);
    for (final message in await bridge.take()) {
      final outcome = await capture.handle(
          message.sender, message.body, message.receivedAt);
      final results = switch (outcome) {
        Delivered(:final result, :final earlier) => [...earlier, result],
        Queued(:final earlier) => earlier,
        _ => const <dynamic>[],
      };
      for (final result in results) {
        final plan = planNotification(result);
        if (plan != null) await NotificationService.show(plan);
      }
    }
  } finally {
    await bridge.done();
  }
}

/// A category button on the notification was tapped while the app was closed.
@pragma('vm:entry-point')
Future<void> notificationAction(NotificationResponse response) async {
  final action = response.actionId;
  if (action == null || action.isEmpty) return;
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.init();
  final store = await PrefsStore.open();
  final outcome = await handleCategoryAction(store, action, response.payload);
  switch (outcome) {
    case ActionResult.done:
    case ActionResult.ignored:
      break;
    case ActionResult.alreadyCategorised:
      await NotificationService.note('Already categorised',
          'It was set to something else first, so that stays.');
    case ActionResult.offline:
      await NotificationService.note('No connection',
          'Open ZeroDue to choose the category when you are back online.');
    case ActionResult.needsPairing:
      await NotificationService.note(
          'Pair this phone again', 'Open ZeroDue and pair with a new code.');
  }
}
