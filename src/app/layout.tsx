import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/service-worker-register';

export const metadata: Metadata = {
  title: 'SAC — Sistema de Administración Comunitaria',
  description:
    'Plataforma multi-comité para administrar finanzas, miembros, actividades y bonos comunitarios.',
  applicationName: 'SAC',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SAC',
  },
  icons: {
    // Favicon en SVG (`public/favicon.svg`). Los PNG de la PWA sirven de
    // respaldo para navegadores que no soporten favicon SVG.
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/icons/icon-192.png',
    shortcut: '/favicon.svg',
  },
};

// Mobile-first viewport: correct scaling on phones, tablets and desktop (Requirement 42.1, 43.1).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1d4ed8',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
