// Run: deno test supabase/functions/lead-otp
import { assertEquals } from 'jsr:@std/assert@1';
import { cleanEmail, cleanMobile, cleanName, cleanOtp, suggestEmail, validateLead } from './rules.ts';

Deno.test('names: real names in any script pass, junk does not', () => {
  assertEquals(cleanName('  Rajat   Raghatwan ').value, 'Rajat Raghatwan');
  assertEquals(cleanName('रजत रघटवान').error, undefined);
  assertEquals(cleanName("Ananya D'Souza").error, undefined);
  assertEquals(cleanName('Ram-Prasad K.').error, undefined);
  assertEquals(cleanName('R').error, 'Please enter your full name.');
  assertEquals(cleanName('').error, 'Please enter your full name.');
  assertEquals(cleanName('John123').error, 'Please use letters only — no numbers or symbols.');
  assertEquals(cleanName('<script>alert(1)</script>').error, 'Please use letters only — no numbers or symbols.');
  assertEquals(cleanName('Visit http://spam.example').error, 'Please use letters only — no numbers or symbols.');
  assertEquals(cleanName('=HYPERLINK("x")').error, 'Please use letters only — no numbers or symbols.');
  assertEquals(cleanName('a'.repeat(81)).error, 'Please keep your name under 80 characters.');
  // Right-to-left override and zero-width characters are stripped.
  assertEquals(cleanName('Ra‮jat​ Kumar').value, 'Rajat Kumar');
});

Deno.test('emails: normalised, strictly checked, typos only suggested', () => {
  assertEquals(cleanEmail('  Rajat@Gmail.COM ').value, 'rajat@gmail.com');
  assertEquals(cleanEmail('first.last+course@mail.example.co.in').error, undefined);
  for (const bad of ['', 'a@b', 'a..b@x.com', '.a@x.com', 'a.@x.com', 'a@x.c', 'a@-x.com', 'a b@x.com', 'a@@x.com', 'a@x..com', 'a@x.com.']) {
    assertEquals(Boolean(cleanEmail(bad).error), true, bad);
  }
  assertEquals(cleanEmail(`${'a'.repeat(65)}@x.com`).error, 'Please enter a valid email address.');
  assertEquals(suggestEmail('rajat@gmial.com'), 'rajat@gmail.com');
  assertEquals(suggestEmail('rajat@gmail.com'), null);
});

Deno.test('mobile: accepts how people type Indian numbers', () => {
  for (const input of ['9876543210', '+91 98765 43210', '+91-98765-43210', '098765 43210', '919876543210', '(98765) 43210', '९८७६५४३२१०']) {
    assertEquals(cleanMobile(input), { value: '9876543210' }, input);
  }
  assertEquals(cleanMobile('5876543210').error, 'Please enter a valid 10-digit mobile number.');
  assertEquals(cleanMobile('98765').error, 'Please enter a valid 10-digit mobile number.');
  assertEquals(cleanMobile('9999999999').error, 'Please enter your real mobile number.');
  assertEquals(cleanMobile('+1 555 123 4567').error, 'Please enter an Indian mobile number (+91).');
  assertEquals(cleanMobile('').error, 'Please enter your mobile number.');
});

Deno.test('otp: spaces and Indian-script digits are fine', () => {
  assertEquals(cleanOtp(' 123 456 '), '123456');
  assertEquals(cleanOtp('१२३४५६'), '123456');
  assertEquals(cleanOtp(null), '');
});

const good = {
  name: 'Neha Sharma',
  email: 'neha@example.com',
  mobile: '+91 98765 43210',
  program: 'Professional Certification in AI',
  source: 'demo_lecture_request',
  education: 'Graduate',
  consent: true,
};

Deno.test('validateLead: whole form', () => {
  const ok = validateLead(good);
  assertEquals(ok.ok && ok.lead, {
    name: 'Neha Sharma',
    email: 'neha@example.com',
    mobile: '9876543210',
    program: 'Professional Certification in AI',
    source: 'demo_lecture_request',
    education: 'Graduate',
  });

  const bad = validateLead({ ...good, name: '1', email: 'x', consent: 'yes', education: 'Astronaut', source: 'demo_lecture_request' });
  assertEquals(!bad.ok && Object.keys(bad.errors).sort(), ['consent', 'education', 'email', 'name']);

  assertEquals(validateLead({ ...good, source: 'made_up' }).ok, false);
  // Education only applies to the demo form.
  const brochure = validateLead({ ...good, source: 'ai_brochure', education: 'Astronaut' });
  assertEquals(brochure.ok && brochure.lead.education, null);
});
