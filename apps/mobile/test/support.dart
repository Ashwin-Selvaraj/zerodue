import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:zerodue/core/api.dart';
import 'package:zerodue/core/models.dart';

/// A fake server: each request is answered by [respond], and every request is kept for checking.
class FakeServer {
  FakeServer(this.respond);

  http.Response Function(http.BaseRequest request, Map<String, Object?>? body)
      respond;
  final List<
      ({
        String method,
        String path,
        Map<String, Object?>? body,
        Map<String, String> headers
      })> requests = [];

  MockClient get client => MockClient.streaming((request, bodyStream) async {
        final raw = await bodyStream.bytesToString();
        final body = raw.isEmpty
            ? null
            : (jsonDecode(raw) as Map).cast<String, Object?>();
        requests.add((
          method: request.method,
          path: request.url.path,
          body: body,
          headers: request.headers
        ));
        final response = respond(request, body);
        return http.StreamedResponse(
          Stream.value(utf8.encode(response.body)),
          response.statusCode,
          headers: response.headers,
        );
      });

  ApiClient api({String? token = 'zd_dev_test'}) =>
      ApiClient('https://zerodue.example', token: token, client: client);
}

http.Response json(int status, Object body) =>
    http.Response(jsonEncode(body), status,
        headers: {'content-type': 'application/json'});

Map<String, Object?> ingestJson({
  String transactionId = '11111111-1111-4111-8111-111111111111',
  String type = 'EXPENSE',
  bool deduped = false,
  String status = 'PENDING_CATEGORY',
  String? categoryId,
  String title = '₹450 paid to SHELL',
}) =>
    {
      'transactionId': transactionId,
      'type': type,
      'deduped': deduped,
      'status': status,
      'categoryId': categoryId,
      'title': title,
      'quickPicks': [
        {'id': 'fuel-id', 'name': 'Fuel'},
        {'id': 'food-id', 'name': 'Food & going out'},
        {'id': 'card-id', 'name': 'Card'},
        {'id': 'misc-id', 'name': 'Misc'},
      ],
    };

IngestResult ingestResult({
  String type = 'EXPENSE',
  bool deduped = false,
  String status = 'PENDING_CATEGORY',
}) =>
    IngestResult.fromJson(
        ingestJson(type: type, deduped: deduped, status: status));
