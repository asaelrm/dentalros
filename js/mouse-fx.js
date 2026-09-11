/**
 * Módulo de Efectos de Desplazamiento del Mouse y Spotlight Interactivo
 * Sistema DentalRos
 */

(function () {
  'use strict';

  function initMouseEffects() {
    // 1. Crear capas de luz si no existen
    let spotlight = document.getElementById('mouse-spotlight-layer');
    if (!spotlight) {
      spotlight = document.createElement('div');
      spotlight.id = 'mouse-spotlight-layer';
      document.body.prepend(spotlight);
    }

    let cursorOrb = document.getElementById('mouse-cursor-orb');
    if (!cursorOrb && window.innerWidth > 768) {
      cursorOrb = document.createElement('div');
      cursorOrb.id = 'mouse-cursor-orb';
      document.body.appendChild(cursorOrb);
    }

    // 2. Seguimiento suave del mouse (con requestAnimationFrame para 60fps / 120fps fluidos)
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let currentX = mouseX;
    let currentY = mouseY;
    let isTicking = false;

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;

      if (!isTicking) {
        window.requestAnimationFrame(() => {
          // Suavizado cinemático
          currentX += (mouseX - currentX) * 0.45;
          currentY += (mouseY - currentY) * 0.45;

          document.documentElement.style.setProperty('--mouse-x', `${currentX}px`);
          document.documentElement.style.setProperty('--mouse-y', `${currentY}px`);

          isTicking = false;
        });
        isTicking = true;
      }
    }, { passive: true });

    // 3. Resplandor magnético individual en tarjetas (Glass Cards)
    document.addEventListener('mousemove', (e) => {
      const card = e.target.closest('.glass-card, .paciente-item, .arcada-section');
      if (card) {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty('--card-mouse-x', `${x}px`);
        card.style.setProperty('--card-mouse-y', `${y}px`);
      }
    }, { passive: true });

    // 4. Efecto de inclinación 3D sutil (Micro-tilt) en la tarjeta principal de bienvenida y odontograma
    const applyTilt = (el) => {
      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        const tiltX = (y / (rect.height / 2)) * -2.5;
        const tiltY = (x / (rect.width / 2)) * 2.5;
        el.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateY(-2px)`;
      });

      el.addEventListener('mouseleave', () => {
        el.style.transform = '';
      });
    };

    document.querySelectorAll('.glass-panel').forEach(panel => {
      if (window.innerWidth > 1024) {
        applyTilt(panel);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMouseEffects);
  } else {
    initMouseEffects();
  }
})();
