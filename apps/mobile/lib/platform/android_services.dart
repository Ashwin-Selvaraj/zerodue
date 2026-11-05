import 'package:permission_handler/permission_handler.dart';

import '../core/notification_plan.dart';
import 'device_services.dart';
import 'native_bridge.dart';
import 'notifications.dart';

/// The real phone: permissions, the Kotlin receiver and notifications.
class AndroidServices implements DeviceServices {
  const AndroidServices();
  static const _bridge = NativeBridge();

  @override
  Future<DevicePermissions> permissions() async => DevicePermissions(
        sms: await Permission.sms.isGranted,
        notifications: await Permission.notification.isGranted,
        batteryExempt: await Permission.ignoreBatteryOptimizations.isGranted,
      );

  @override
  Future<void> requestPermissions() async {
    // one at a time: Android shows one system dialog per request
    await Permission.sms.request();
    await Permission.notification.request();
    await Permission.ignoreBatteryOptimizations.request();
  }

  @override
  Future<void> setAllowList(List<String> patterns) =>
      _bridge.setAllowList(patterns);

  @override
  Future<List<RawSms>> takePending() => _bridge.take();

  @override
  Future<void> notify(NotificationPlan plan) => NotificationService.show(plan);
}
