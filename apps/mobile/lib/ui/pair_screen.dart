import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../core/pairing_qr.dart';
import 'qr_scan_screen.dart';

/// First screen: type the address and the code shown in the web app (More → Phone capture).
class PairScreen extends StatefulWidget {
  const PairScreen({
    super.key,
    required this.controller,
    this.scan = scanPairingQr,
  });
  final AppController controller;

  /// Opens the camera; replaced in tests.
  final QrScanner scan;

  @override
  State<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends State<PairScreen> {
  final _url = TextEditingController();
  final _code = TextEditingController();
  final _name = TextEditingController(text: 'My phone');
  bool _busy = false;
  String? _scanProblem;

  @override
  void dispose() {
    _url.dispose();
    _code.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _pair() async {
    setState(() => _busy = true);
    await widget.controller.pair(_url.text, _code.text,
        _name.text.trim().isEmpty ? 'My phone' : _name.text.trim());
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _scan() async {
    final text = await widget.scan(context);
    if (text == null || !mounted) return;
    final qr = parsePairingQr(text);
    if (qr == null) {
      setState(() => _scanProblem = 'That is not a ZeroDue pairing code.');
      return;
    }
    _url.text = qr.apiUrl;
    _code.text = qr.code;
    setState(() => _scanProblem = null);
    await _pair();
  }

  @override
  Widget build(BuildContext context) {
    final error = _scanProblem ?? widget.controller.error;
    return Scaffold(
      appBar: AppBar(title: const Text('Pair this phone')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'In the ZeroDue web app, open More → Phone capture → Pair a phone. '
            'Scan the QR code it shows, or type the address and code.',
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _busy ? null : _scan,
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('Scan QR code'),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _url,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Server address',
              hintText: 'https://api.example.com',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _code,
            textCapitalization: TextCapitalization.characters,
            autocorrect: false,
            decoration: const InputDecoration(
                labelText: 'Pairing code', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _name,
            decoration: const InputDecoration(
                labelText: 'Name for this phone', border: OutlineInputBorder()),
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(error,
                  style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _pair,
            child: Text(_busy ? 'Pairing…' : 'Pair'),
          ),
        ],
      ),
    );
  }
}
