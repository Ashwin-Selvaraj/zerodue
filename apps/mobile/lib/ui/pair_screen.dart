import 'package:flutter/material.dart';

import '../app_controller.dart';

/// First screen: type the address and the code shown in the web app (More → Phone capture).
class PairScreen extends StatefulWidget {
  const PairScreen({super.key, required this.controller});
  final AppController controller;

  @override
  State<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends State<PairScreen> {
  final _url = TextEditingController();
  final _code = TextEditingController();
  final _name = TextEditingController(text: 'My phone');
  bool _busy = false;

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

  @override
  Widget build(BuildContext context) {
    final error = widget.controller.error;
    return Scaffold(
      appBar: AppBar(title: const Text('Pair this phone')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'In the ZeroDue web app, open More → Phone capture → Pair a phone. '
            'Type the server address and the code it shows.',
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
