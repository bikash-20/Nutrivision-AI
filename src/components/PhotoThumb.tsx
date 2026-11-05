import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ScanLine } from 'lucide-react';
import { T } from '../data';
import { LocalizedContent, useLanguage } from '../i18n/LanguageContext';

interface PhotoThumbProps {
  /** Data URL or image URL of the captured photo. */
  src?: string | null;
  /** Optional inline styles to customize positioning/margins. */
  style?: React.CSSProperties;
}

/**
 * Circular thumbnail of the captured photo.
 * Shows the real image when a src is provided, otherwise a placeholder.
 */
export default function PhotoThumb({ src, style }: PhotoThumbProps) {
  const { language } = useLanguage();
  const isBn = language === 'bn';
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!expanded || !src) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (dialog.open) dialog.close();
      setExpanded(false);
    };
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded, src]);

  return (
    <LocalizedContent>
    <div
      style={{
        position: 'relative',
        zIndex: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        ...style,
      }}
    >
      {src ? (
        <motion.button
          type="button"
          onClick={() => setExpanded(true)}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          aria-label={isBn ? 'তোলা ছবিটি দেখুন' : 'View captured photo'}
          style={{
            position: 'relative',
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            background:
              'linear-gradient(160deg, rgba(74, 58, 52, 0.95), rgba(46, 37, 34, 0.98))',
            boxShadow:
              '0 6px 14px -4px rgba(46, 37, 34, 0.45), inset 0 1.5px 0 rgba(255, 255, 255, 0.15)',
            overflow: 'hidden',
          }}
        >
          <img
            src={src}
            alt="Captured meal"
            style={{
              position: 'absolute',
              inset: 2,
              width: 'calc(100% - 4px)',
              height: 'calc(100% - 4px)',
              borderRadius: '50%',
              objectFit: 'cover',
            }}
          />
        </motion.button>
      ) : (
        <div
          aria-hidden="true"
          style={{
            position: 'relative',
            width: 44,
            height: 44,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(160deg, rgba(74, 58, 52, 0.95), rgba(46, 37, 34, 0.98))',
            boxShadow: '0 6px 14px -4px rgba(46, 37, 34, 0.45)',
            color: T.earth6,
          }}
        >
          <ScanLine size={18} strokeWidth={1.8} />
        </div>
      )}

      {expanded && src && typeof document !== 'undefined' && createPortal(
        <dialog
          ref={dialogRef}
          className="photo-preview-dialog"
          aria-label={isBn ? 'তোলা খাবারের ছবি' : 'Captured meal photo'}
          onCancel={() => setExpanded(false)}
          onClose={() => setExpanded(false)}
          onClick={(event) => {
            if (event.target === dialogRef.current) setExpanded(false);
          }}
        >
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={isBn ? 'ছবি বন্ধ করুন' : 'Close photo'}
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                zIndex: 1,
                width: 44,
                height: 44,
                border: 'none',
                borderRadius: '50%',
                background: 'rgba(46, 37, 34, 0.82)',
                color: '#FFFFFF',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
            <img
              src={src}
              alt={isBn ? 'তোলা খাবারের ছবি' : 'Captured meal'}
              style={{
                display: 'block',
                maxWidth: 'min(92vw, 960px)',
                maxHeight: '85dvh',
                objectFit: 'contain',
                borderRadius: 12,
              }}
            />
          </div>
        </dialog>,
        document.body,
      )}
    </div>
    </LocalizedContent>
  );
}