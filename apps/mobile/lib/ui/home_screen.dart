import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/models.dart';
import 'captures_tab.dart';
import 'inbox_tab.dart';
import 'test_tab.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final tabs = <Widget>[
      CapturesTab(controller: controller),
      InboxTab(
          key: ValueKey('inbox-${controller.pending}'), controller: controller),
      TestTab(
          allowList: controller.session?.allowList ?? Session.defaultAllowList),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('ZeroDue')),
      body: tabs[controller.tab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: controller.tab,
        onDestinationSelected: controller.showTab,
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.sms_outlined), label: 'Captures'),
          NavigationDestination(
              icon: Icon(Icons.inbox_outlined), label: 'Inbox'),
          NavigationDestination(
              icon: Icon(Icons.science_outlined), label: 'Test'),
        ],
      ),
    );
  }
}
