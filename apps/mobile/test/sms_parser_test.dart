import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:zerodue/core/sms_parser.dart';

/// The same messages and expected readings the TypeScript reader is tested against.
const fixturesPath = '../../packages/shared/src/sms/fixtures.json';
const allowList = ['*-ICICIB', '*-ICICIT', '*-ICICIS'];

void main() {
  final fixtures =
      (jsonDecode(File(fixturesPath).readAsStringSync()) as List<dynamic>)
          .cast<Map<String, dynamic>>();

  group('shared message fixtures', () {
    test('there are fixtures to run', () => expect(fixtures, isNotEmpty));

    for (final fixture in fixtures) {
      test(fixture['name'] as String, () {
        final reading = readSms(
            fixture['sender'] as String, fixture['body'] as String, allowList);
        final expected = fixture['expected'] as Map<String, dynamic>;
        if (expected['kind'] == 'ignored') {
          expect(reading.payment, isNull);
          expect(reading.ignored!.code, expected['reason']);
        } else {
          expect(reading.ignored, isNull);
          final want = expected['payment'] as Map<String, dynamic>;
          final got = reading.payment!.toJson();
          expect(got.keys.toSet(), want.keys.toSet());
          for (final key in want.keys) {
            if (key == 'confidence') {
              expect(got[key] as num, closeTo(want[key] as num, 1e-9),
                  reason: key);
            } else {
              expect(got[key], want[key], reason: key);
            }
          }
        }
      });
    }
  });

  group('senderAllowed', () {
    test('matches * as anything, ignoring case and surrounding spaces', () {
      expect(senderAllowed('VM-ICICIB', allowList), isTrue);
      expect(senderAllowed(' vk-icicis ', allowList), isTrue);
      expect(senderAllowed('VM-ICICIBX', allowList), isFalse);
      expect(senderAllowed('ICICIB', allowList), isFalse);
    });

    test('treats other characters in a pattern literally', () {
      expect(senderAllowed('A.B', ['A.B']), isTrue);
      expect(senderAllowed('AXB', ['A.B']), isFalse);
      expect(senderAllowed('X', []), isFalse);
    });
  });

  group('parseSms', () {
    test('reads across line breaks and extra spaces', () {
      final p =
          parseSms('Rs  450.00\n debited   at  SHELL  on 03-Nov-26').payment!;
      expect(p.amountPaise, 45000);
      expect(p.merchant, 'SHELL');
    });

    test('keeps paise exact', () {
      int amount(String body) => parseSms(body).payment!.amountPaise;
      expect(amount('Rs 10.5 debited'), 1050);
      expect(amount('Rs 10 debited'), 1000);
      expect(amount('Rs 1,23,456.07 debited'), 12345607);
    });

    test('calls it a credit when that comes first, and a debit when that does',
        () {
      expect(parseSms('Rs 5 credited, SHELL debited').payment!.direction,
          'CREDIT');
      expect(
          parseSms('Rs 5 debited; SHELL credited').payment!.direction, 'DEBIT');
    });

    test('reports no merchant shorter than two characters', () {
      expect(parseSms('Rs 5 debited at X.').payment!.merchant, isNull);
    });
  });

  test('a payment survives a round trip through JSON', () {
    final p =
        parseSms('Rs 450.00 debited at SHELL on 05-Nov-26 UPI:312345678901')
            .payment!;
    final again = ParsedPayment.fromJson(
        jsonDecode(jsonEncode(p.toJson())) as Map<String, Object?>);
    expect(again.toJson(), p.toJson());
  });
}
