import 'api.dart';
import 'notification_plan.dart';
import 'session_store.dart';
import 'store.dart';

enum ActionResult {
  /// The category was set.
  done,

  /// Someone categorised it differently first; theirs stays.
  alreadyCategorised,

  /// No connection: tell the user to open the app.
  offline,

  /// This phone was removed in the web app.
  needsPairing,

  /// Not a category button, or a payment we cannot identify.
  ignored,
}

/// A category button on the notification was tapped. Runs without the app on screen.
Future<ActionResult> handleCategoryAction(
  KeyValueStore store,
  String actionId,
  String? payload, {
  ApiClient Function(String apiUrl, String token)? apiFor,
}) async {
  final categoryId = categoryOfAction(actionId);
  final transactionId = transactionOfPayload(payload);
  if (categoryId == null || transactionId.isEmpty) return ActionResult.ignored;

  final session = await SessionStore(store).load();
  if (session == null) return ActionResult.needsPairing;
  final api = apiFor != null
      ? apiFor(session.apiUrl, session.deviceToken)
      : ApiClient(session.apiUrl, token: session.deviceToken);
  try {
    await api.categorise(transactionId, categoryId);
    return ActionResult.done;
  } on OfflineException {
    return ActionResult.offline;
  } on ApiException catch (e) {
    if (e.status == 409) return ActionResult.alreadyCategorised;
    if (e.revoked) return ActionResult.needsPairing;
    rethrow;
  }
}
