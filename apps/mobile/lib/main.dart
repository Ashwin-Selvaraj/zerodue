import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'app_controller.dart';
import 'background.dart';
import 'core/capture.dart';
import 'core/store.dart';
import 'platform/android_services.dart';
import 'platform/notifications.dart';
import 'ui/home_screen.dart';
import 'ui/pair_screen.dart';

const appName = 'ZeroDue';
const appTagline = 'Track every rupee. Clear every loan.';

/// The entry point the Kotlin service runs in its headless engine when a bank message arrives.
@pragma('vm:entry-point')
Future<void> ingestMain() => runIngestBackground();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await PrefsStore.open();
  final controller =
      AppController(CaptureService(store), const AndroidServices());
  await NotificationService.init(
    onTap: (NotificationResponse response) =>
        controller.showTab(1), // tapping the notification opens the inbox
    onBackgroundAction: notificationAction,
  );
  runApp(ZeroDueApp(controller: controller));
}

class ZeroDueApp extends StatefulWidget {
  const ZeroDueApp({super.key, required this.controller});
  final AppController controller;

  @override
  State<ZeroDueApp> createState() => _ZeroDueAppState();
}

class _ZeroDueAppState extends State<ZeroDueApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.controller.load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // coming back to the app: pick up messages kept while it was closed, and send what is waiting
    if (state == AppLifecycleState.resumed) {
      widget.controller.load();
    }
  }

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF0F766E);
    return MaterialApp(
      title: appName,
      theme: ThemeData(colorSchemeSeed: seed, useMaterial3: true),
      darkTheme: ThemeData(
          colorSchemeSeed: seed,
          brightness: Brightness.dark,
          useMaterial3: true),
      home: ListenableBuilder(
        listenable: widget.controller,
        builder: (context, _) {
          final c = widget.controller;
          if (c.loading) {
            return const Scaffold(body: Center(child: CircularProgressIndicator()));
          }
          return c.paired
              ? HomeScreen(controller: c)
              : PairScreen(controller: c);
        },
      ),
    );
  }
}
