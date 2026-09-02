/**
 * Logo de la aplicación (SAC).
 *
 * Renderiza el archivo `public/logo.svg`. Para cambiar el logo, reemplaza ese
 * archivo en `public/`; todos los lugares que usan <AppLogo/> se actualizan
 * solos (login, registro, barra lateral y encabezado).
 *
 * Se usa <img> (no next/image) para servir el SVG tal cual, sin optimización ni
 * dependencias adicionales. Hereda el tamaño vía la prop `size` (por defecto 40).
 */
export function AppLogo({
  size = 40,
  title = 'SAC',
  className,
  src = '/logo.png',
}: {
  size?: number;
  title?: string;
  className?: string;
  /** Ruta del logo. Por defecto `/logo.png`; se puede sobreescribir (p. ej. una variante para móvil). */
  src?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={title}
      width={size}
      height={size}
      className={['object-contain', className].filter(Boolean).join(' ')}
    />
  );
}
