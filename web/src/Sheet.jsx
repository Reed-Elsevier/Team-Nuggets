import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';

const SPRING = { type: 'spring', bounce: 0, duration: 0.4 };

// Apple's scroll-deceleration projection: where a flick would come to rest.
const project = (v, rate = 0.998) => (v / 1000) * rate / (1 - rate);

export default function Sheet({ open, onClose, title, children, footer }) {
  const panel = useRef(null);
  const controls = useDragControls();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    requestAnimationFrame(() => panel.current?.querySelector('input, textarea, select')?.focus());
    return () => { window.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [open, onClose]);

  // Portal: transformed ancestors (layout/page animations) would break position: fixed.
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="sheet-layer">
          <motion.div className="scrim" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
          <motion.section
            ref={panel} className="sheet" role="dialog" aria-modal="true" aria-label={title}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={SPRING}
            drag="y" dragControls={controls} dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.04, bottom: 1 }}
            dragTransition={{ bounceStiffness: 400, bounceDamping: 40 }}
            onDragEnd={(e, info) => {
              // Dismiss based on where the flick is heading, not just where the finger let go.
              const height = panel.current?.offsetHeight ?? 400;
              if (info.offset.y + project(info.velocity.y) > height * 0.5) onClose();
            }}
          >
            <div className="sheet-grab" onPointerDown={e => controls.start(e)}>
              <span className="grabber" aria-hidden="true" />
              <header className="sheet-head">
                <h2>{title}</h2>
                <button className="btn ghost" onClick={onClose}>Close</button>
              </header>
            </div>
            <div className="sheet-body">{children}</div>
            {footer && <footer className="sheet-foot">{footer}</footer>}
          </motion.section>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
