import 'dart:convert';

import 'models.dart';

/// Android shows at most three buttons on a notification.
const maxActions = 3;

/// What to show for a captured payment: the words and the category buttons.
class NotificationPlan {
  const NotificationPlan({
    required this.id,
    required this.title,
    required this.body,
    required this.actions,
    required this.payload,
    required this.quiet,
  });

  final int id;
  final String title;
  final String body;

  /// Button id (`cat:<categoryId>`) to label.
  final Map<String, String> actions;

  /// Handed back when a button or the notification is tapped.
  final String payload;

  /// Informational only: no sound, nothing to do.
  final bool quiet;
}

/// A positive 31-bit id for a transaction, so showing it twice replaces rather than stacks.
int notificationId(String transactionId) => transactionId.hashCode & 0x7fffffff;

const _actionPrefix = 'cat:';

String actionFor(String categoryId) => '$_actionPrefix$categoryId';

/// The category id behind a button, or null when it is not a category button.
String? categoryOfAction(String actionId) => actionId.startsWith(_actionPrefix)
    ? actionId.substring(_actionPrefix.length)
    : null;

String transactionOfPayload(String? payload) {
  try {
    return ((jsonDecode(payload ?? '') as Map)['t'] as String?) ?? '';
  } on Object {
    return '';
  }
}

/// How to tell the user about a payment, or null when there is nothing new to say (the same payment
/// seen again in another message, or one marked not a payment).
NotificationPlan? planNotification(IngestResult result) {
  if (result.deduped || result.status == 'IGNORED') return null;
  final payload = jsonEncode({'t': result.transactionId});
  final id = notificationId(result.transactionId);

  if (result.status == 'POSTED') {
    return NotificationPlan(
      id: id,
      title: result.title,
      body: 'Categorised automatically.',
      actions: const {},
      payload: payload,
      quiet: true,
    );
  }
  if (result.type == 'INCOME') {
    return NotificationPlan(
      id: id,
      title: result.title,
      body: 'Open ZeroDue to choose a category.',
      actions: const {},
      payload: payload,
      quiet: false,
    );
  }
  return NotificationPlan(
    id: id,
    title: '${result.title}. What type of payment?',
    body: 'Tap a category, or tap here for more.',
    actions: {
      for (final q in result.quickPicks.take(maxActions))
        actionFor(q.id): q.name
    },
    payload: payload,
    quiet: false,
  );
}
