import "./globals.css";
export const metadata = { title: "MCQ Test", description: "PDF se MCQ test" };
export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>);
}
