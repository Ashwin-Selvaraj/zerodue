import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/sms_parser.dart';

/// Paste a message to see exactly how it would be read, and whether it would be captured at all.
class TestTab extends StatefulWidget {
  const TestTab({super.key, required this.allowList});
  final List<String> allowList;

  @override
  State<TestTab> createState() => _TestTabState();
}

class _TestTabState extends State<TestTab> {
  final _sender = TextEditingController();
  final _body = TextEditingController();
  SmsReading? _reading;

  @override
  void dispose() {
    _sender.dispose();
    _body.dispose();
    super.dispose();
  }

  void _run() {
    final sender = _sender.text.trim();
    setState(() {
      _reading = sender.isEmpty
          ? parseSms(_body.text)
          : readSms(sender, _body.text, widget.allowList);
    });
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 110, child: Text(label)),
            Expanded(child: Text(value))
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final payment = _reading?.payment;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        TextField(
          controller: _sender,
          decoration: const InputDecoration(
              labelText: 'Sender, e.g. VM-ICICIB (optional)',
              border: OutlineInputBorder()),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _body,
          minLines: 4,
          maxLines: 8,
          decoration: const InputDecoration(
              labelText: 'Paste a bank message', border: OutlineInputBorder()),
        ),
        const SizedBox(height: 12),
        FilledButton(onPressed: _run, child: const Text('See how it is read')),
        const SizedBox(height: 16),
        if (_reading?.ignored != null) Text(_reading!.ignored!.explanation),
        if (payment != null) ...[
          _row(payment.direction == 'DEBIT' ? 'Paid' : 'Received',
              formatRupees(payment.amountPaise)),
          if (payment.merchant != null) _row('Merchant', payment.merchant!),
          if (payment.vpa != null) _row('UPI address', payment.vpa!),
          if (payment.accountTail != null)
            _row('Account', '…${payment.accountTail}'),
          if (payment.upiRef != null) _row('Reference', payment.upiRef!),
          if (payment.occurredAt != null) _row('When', payment.occurredAt!),
          _row('Confidence', '${(payment.confidence * 100).round()}%'),
        ],
      ],
    );
  }
}
