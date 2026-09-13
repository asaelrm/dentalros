'use strict';
const nodemailer = require('nodemailer');

function mailConfiguration(env = process.env) {
  let base;
  try { base = new URL(env.PUBLIC_URL); } catch { throw new Error('Configura PUBLIC_URL con la dirección pública actual del sistema.'); }
  if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))) {
    throw new Error('PUBLIC_URL debe usar HTTPS (o HTTP solo para localhost).');
  }
  if (!env.SMTP_HOST || !env.SMTP_FROM || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new Error('Configura SMTP_HOST, SMTP_FROM, SMTP_USER y SMTP_PASSWORD para enviar invitaciones.');
  }
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT no es válido.');
  return { baseUrl: base.href, from: env.SMTP_FROM, transport: {
    host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === 'true', requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false
  } };
}

function createInvitationMailer(env = process.env) {
  const config = mailConfiguration(env);
  const transport = nodemailer.createTransport(config.transport);
  return { baseUrl: config.baseUrl, async send({ email, displayName, username, url }) {
    const result = await transport.sendMail({
      from: config.from, to: { address: email, name: displayName },
      subject: 'DentalRos: crea tu contraseña',
      text: `Hola ${displayName},\n\nTu usuario de DentalRos es: ${username}.\nAbre este enlace para establecer tu contraseña privada:\n${url}\n\nEl enlace vence en 24 horas y solo puede utilizarse una vez. No compartas este enlace.\nEl administrador no conoce tu contraseña.\nSi no esperabas este correo, no utilices el enlace.`
    });
    if (!result.accepted?.length) throw new Error('El servidor SMTP no aceptó el destinatario.');
  } };
}
module.exports = { createInvitationMailer, mailConfiguration };
