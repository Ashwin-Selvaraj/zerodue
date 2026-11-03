import 'package:flutter_test/flutter_test.dart';
import 'package:zerodue/main.dart';

void main() {
  testWidgets('shows ZeroDue name and tagline', (tester) async {
    await tester.pumpWidget(const ZeroDueApp());
    expect(find.text('ZeroDue'), findsOneWidget);
    expect(find.text('Track every rupee. Clear every loan.'), findsOneWidget);
  });
}
