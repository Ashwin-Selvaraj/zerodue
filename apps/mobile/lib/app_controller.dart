import 'package:flutter/foundation.dart';

import 'core/api.dart';
import 'core/capture.dart';
import 'core/models.dart';
import 'core/notification_plan.dart';
import 'platform/device_services.dart';

/// Holds what the screens show, and does what the buttons ask.
class AppController extends ChangeNotifier {
  AppController(this.capture, this.device);

  final CaptureService capture;
  final DeviceServices device;

  bool loading = true;
  Session? session;
  bool needsPairing = false;
  int pending = 0;
  List<CaptureLogEntry> log = const [];
  DevicePermissions permissions = const DevicePermissions();
  String? error;

  /// The tab to show (0 captures, 1 inbox, 2 test); set when a notification is tapped.
  int tab = 0;

  bool get paired => session != null;

  /// Called when the app opens or comes back: reads anything the receiver kept, sends the queue,
  /// refreshes the allow-list and category buttons, and updates what is on screen.
  Future<void> load() async {
    session = await capture.session();
    if (session != null) {
      session = await capture.refreshConfig() ?? session;
      await device.setAllowList(session!.allowList);
      await _handleKept();
      await _notifyAll(
          (await capture.flush(force: true)).sent.map((s) => s.result));
    }
    await _refresh();
    loading = false;
    notifyListeners();
  }

  Future<void> _handleKept() async {
    for (final message in await device.takePending()) {
      final outcome = await capture.handle(
          message.sender, message.body, message.receivedAt);
      await _notifyAll(switch (outcome) {
        Delivered(:final result, :final earlier) => [...earlier, result],
        Queued(:final earlier) => earlier,
        _ => const <IngestResult>[],
      });
    }
  }

  Future<void> _notifyAll(Iterable<IngestResult> results) async {
    for (final result in results) {
      final plan = planNotification(result);
      if (plan != null) await device.notify(plan);
    }
  }

  Future<void> _refresh() async {
    session = await capture.session();
    needsPairing = await capture.needsPairing();
    pending = await capture.pending();
    log = await capture.log();
    permissions = await device.permissions();
  }

  Future<bool> pair(String apiUrl, String code, String deviceName) async {
    error = null;
    notifyListeners();
    try {
      await capture.pair(apiUrl, code, deviceName);
      await load();
      return true;
    } on ApiException catch (e) {
      error = e.message;
    } on OfflineException {
      error =
          'Could not reach the server. Check the address and your connection.';
    }
    notifyListeners();
    return false;
  }

  Future<void> unpair() async {
    await capture.unpair();
    await device.setAllowList(Session.defaultAllowList);
    await _refresh();
    notifyListeners();
  }

  Future<void> requestPermissions() async {
    await device.requestPermissions();
    permissions = await device.permissions();
    notifyListeners();
  }

  /// Sends whatever is waiting now.
  Future<void> sendNow() async {
    await _notifyAll(
        (await capture.flush(force: true)).sent.map((s) => s.result));
    await _refresh();
    notifyListeners();
  }

  void showTab(int index) {
    tab = index;
    notifyListeners();
  }

  // ───────────────────────── inbox ─────────────────────────

  Future<List<Map<String, Object?>>> inbox() async {
    try {
      return await capture.inbox();
    } on OfflineException {
      throw const InboxUnavailable('You are offline.');
    } on ApiException catch (e) {
      if (e.revoked) {
        needsPairing = true;
        notifyListeners();
      }
      throw InboxUnavailable(e.message);
    }
  }

  /// Returns a message to show when it did not simply work, or null.
  Future<String?> categorise(String transactionId, String categoryId,
      {bool createRule = false}) async {
    try {
      await capture.categorise(transactionId, categoryId,
          createRule: createRule);
      return null;
    } on OfflineException {
      return 'No connection. Try again when you are online.';
    } on ApiException catch (e) {
      return e.status == 409
          ? 'It was already categorised, so that stays.'
          : e.message;
    }
  }

  Future<String?> ignore(String transactionId) async {
    try {
      await capture.ignore(transactionId);
      return null;
    } on OfflineException {
      return 'No connection. Try again when you are online.';
    } on ApiException catch (e) {
      return e.message;
    }
  }
}

class InboxUnavailable implements Exception {
  const InboxUnavailable(this.message);
  final String message;
}
