// Student portal sidebar — one definition shared by every student page,
// so the order and links stay identical everywhere.
//
// On the dashboard itself, its panels switch in place (`target`); on the
// other student pages the same items link back to the dashboard panel.

export type StudentPage = 'dashboard' | 'resume-generator' | 'my-resumes' | 'linkedin';

interface MenuItem {
  label: string;
  target?: string;
  href?: string;
  active?: boolean;
}

export function studentMenu(page: StudentPage): MenuItem[] {
  const panel = (label: string, target: string): MenuItem =>
    page === 'dashboard' ? { label, target } : { label, href: `/student-dashboard#${target}` };
  const link = (label: string, href: string, key: StudentPage): MenuItem => ({ label, href, active: page === key });

  return [
    panel('My Program / Enrollments', 'my-program'),
    panel('Fees & Payments', 'fees-payments'),
    panel('Fee Receipts', 'receipts'),
    panel('Profile', 'profile'),
    link('Resume Generator', '/student-resume-generator', 'resume-generator'),
    link('My Resumes', '/student-my-resumes', 'my-resumes'),
    panel('Overview', 'overview'),
    panel('Security', 'security'),
    link('LinkedIn Post Generator', '/student-linkedin-generator', 'linkedin'),
  ];
}
