/// Rupees in the Indian digit grouping: 129300 paise... 1,293; 12930000 paise → ₹1,29,300.
String formatRupees(int paise) {
  final negative = paise < 0;
  final abs = paise.abs();
  final rupees = (abs ~/ 100).toString();
  final fraction = abs % 100;
  String grouped;
  if (rupees.length <= 3) {
    grouped = rupees;
  } else {
    final last3 = rupees.substring(rupees.length - 3);
    var rest = rupees.substring(0, rupees.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    grouped = '${parts.join(',')},$last3';
  }
  final cents = fraction == 0 ? '' : '.${fraction.toString().padLeft(2, '0')}';
  return '${negative ? '-' : ''}₹$grouped$cents';
}
