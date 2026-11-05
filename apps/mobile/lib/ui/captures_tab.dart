import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/capture.dart';

/// Setup checklist, what is waiting to send, and the last captured messages.
class CapturesTab extends StatelessWidget {
  const CapturesTab({super.key, required this.controller});
  final AppController controller;

  static String _state(CaptureLogEntry e) => switch (e.state) {
        'sent' => 'Sent',
        'known' => 'Same payment as an earlier message',
        'queued' => 'Waiting to send',
        _ => 'Skipped',
      };

  @override
  Widget build(BuildContext context) {
    final p = controller.permissions;
    Widget check(bool ok, String label) => ListTile(
          dense: true,
          leading: Icon(ok ? Icons.check_circle : Icons.error_outline,
              color: ok ? Colors.green : Colors.orange),
          title: Text(label),
        );

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (controller.needsPairing)
          Card(
            color: Theme.of(context).colorScheme.errorContainer,
            child: ListTile(
              title: const Text('This phone was removed'),
              subtitle: const Text(
                  'Pair it again to keep capturing. Waiting messages are kept.'),
              trailing: TextButton(
                  onPressed: controller.unpair,
                  child: const Text('Pair again')),
            ),
          ),
        Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              children: [
                check(p.sms, 'Allowed to read bank messages'),
                check(p.notifications, 'Allowed to show notifications'),
                check(p.batteryExempt, 'Allowed to run in the background'),
                if (!p.ready)
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: FilledButton(
                        onPressed: controller.requestPermissions,
                        child: const Text('Allow')),
                  ),
              ],
            ),
          ),
        ),
        if (controller.pending > 0)
          Card(
            child: ListTile(
              title: Text('${controller.pending} waiting to send'),
              subtitle:
                  const Text('They send automatically when you are online.'),
              trailing: TextButton(
                  onPressed: controller.sendNow, child: const Text('Send now')),
            ),
          ),
        const SizedBox(height: 8),
        Text('Recent captures', style: Theme.of(context).textTheme.titleMedium),
        if (controller.log.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Text(
                'Nothing yet. Payment messages from your bank show up here.'),
          ),
        for (final entry in controller.log)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(entry.summary),
            subtitle: Text('${entry.sender} · ${_state(entry)}'),
          ),
        const SizedBox(height: 16),
        OutlinedButton(
            onPressed: controller.unpair,
            child: const Text('Unpair this phone')),
      ],
    );
  }
}
