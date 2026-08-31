import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import GlobalErrorHandler from "@/components/global-error-handler";
import { ErrorBoundary } from "@/components/error-boundary";
import { ThemeProvider } from "@/lib/te-theme";

const geistSans = localFont({
  src: [
    { path: "../../public/fonts/DejaVuSans.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/DejaVuSans-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: [
    { path: "../../public/fonts/DejaVuSansMono.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/DejaVuSansMono-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Brrr — MEV Microstructure Engine",
  description: "CEX anomaly detection, microstructure radar, and automated trading.",
  keywords: ["crypto", "anomaly detection", "microstructure", "trading", "CEX", "MEV"],
  authors: [{ name: "Brrr" }],
  icons: {
    icon: "/brrr-logo.svg",
  },
  openGraph: {
    title: "Brrr — MEV Microstructure Engine",
    description: "CEX anomaly detection and microstructure trading",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Brrr — MEV Microstructure Engine",
    description: "CEX anomaly detection and microstructure trading",
  },
};

// Early error interception script — MUST run before React hydrates.
const EARLY_ERROR_GUARD = `(function(){
  window.__DH_ERRORS=[];
  function l(s,m,d,f,ln,co){
    var detail=m;
    if(f) detail+=' ['+f+':'+ln+':'+co+']';
    console.warn('[DH-Guard] '+s+':',detail);
    window.__DH_ERRORS.push({src:s,msg:m,stack:d,file:f,line:ln,col:co,t:Date.now()});
  }
  window.addEventListener('error',function(e){
    l('error',e.message||String(e.error)||'unknown',e.error&&e.error.stack,e.filename,e.lineno,e.colno);
  },true);
  window.addEventListener('unhandledrejection',function(e){
    var r=e.reason;
    l('rejection',r&&r.message?r.message:String(r),r&&r.stack,'',0,0);
  },true);
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY_ERROR_GUARD }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          <GlobalErrorHandler />
          <ErrorBoundary label="layout-root">
            {children}
          </ErrorBoundary>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
