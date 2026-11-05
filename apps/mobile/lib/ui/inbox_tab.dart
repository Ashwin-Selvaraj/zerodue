import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/format.dart';
import '../core/models.dart';

/// Payments waiting for a category, with the same one-tap buttons as the notification.
class InboxTab extends StatefulWidget {
  const InboxTab({super.key, required this.controller});
  final AppController controller;

  @override
  State<InboxTab> createState() => _InboxTabState();
}

class _InboxTabState extends State<InboxTab> {
  late Future<List<Map<String, Object?>>> _items = widget.controller.inbox();

  void _reload() {
    setState(() {
      _items = widget.controller.inbox();
    });
  }

  Future<void> _run(Future<String?> action) async {
    final problem = await action;
    if (!mounted) return;
    if (problem != null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(problem)));
    }
    _reload();
  }

  /// Offers every category, for payments the quick-pick buttons do not fit.
  Future<void> _more(String transactionId) async {
    final List<QuickPick> all;
    try {
      all = await widget.controller.expenseCategories();
    } on InboxUnavailable catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
      return;
    }
    if (!mounted) return;
    final chosen = await showModalBottomSheet<QuickPick>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final c in all)
              ListTile(
                  title: Text(c.name), onTap: () => Navigator.pop(context, c)),
          ],
        ),
      ),
    );
    if (chosen == null || !mounted) return;
    await _run(widget.controller.categorise(transactionId, chosen.id));
  }

  @override
  Widget build(BuildContext context) {
    final picks = widget.controller.session?.quickPicks ?? const [];
    return RefreshIndicator(
      onRefresh: () async => _reload(),
      child: FutureBuilder(
        future: _items,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            final problem = snapshot.error is InboxUnavailable
                ? (snapshot.error! as InboxUnavailable).message
                : 'Could not load the inbox.';
            return ListView(padding: const EdgeInsets.all(16), children: [
              Text(problem),
              TextButton(onPressed: _reload, child: const Text('Try again'))
            ]);
          }
          final items = snapshot.data!;
          if (items.isEmpty) {
            return ListView(
                padding: const EdgeInsets.all(16),
                children: const [Text('All caught up.')]);
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              for (final t in items)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${formatRupees(t['amountPaise']! as int)} ${(t['merchant'] ?? t['vpa'] ?? '')}'
                              .trim(),
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        if (t['type'] == 'INCOME')
                          const Text(
                              'Money received: choose its category in the web app.')
                        else
                          Wrap(
                            spacing: 8,
                            children: [
                              for (final q in picks)
                                ActionChip(
                                  label: Text(q.name),
                                  onPressed: () => _run(widget.controller
                                      .categorise(t['id']! as String, q.id)),
                                ),
                              ActionChip(
                                label: const Text('More…'),
                                onPressed: () => _more(t['id']! as String),
                              ),
                            ],
                          ),
                        TextButton(
                          onPressed: () => _run(
                              widget.controller.ignore(t['id']! as String)),
                          child: const Text('Not a payment'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
