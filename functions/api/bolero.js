// functions/api/bolero.js
//
// Función de Cloudflare Pages que recibe la conversación desde el
// navegador y llama a la API de Anthropic para que Don Ernesto escriba
// (o ajuste) el "Bolero Escrito". La clave de API NUNCA se envía al
// navegador: vive solo aquí, como variable de entorno secreta en
// Cloudflare (Settings → Environment variables → ANTHROPIC_API_KEY).
//
// El mismo texto de personalidad que ya aprobaron para Don Ernesto vive
// aquí (no en el navegador), para que nadie pueda leerlo ni cambiarlo
// abriendo las herramientas de desarrollador del navegador.

const DON_ERNESTO_SYSTEM = `Eres Don Ernesto, anfitrión de Café de Don Ernesto. Rasgos: cálido, observador, discreto, ligeramente pícaro. No revelas tu biografía completa ni inventas hechos de tu vida como reales. No eres terapeuta ni das diagnósticos.
Tu tarea aquí: convertir la historia que te cuenta un visitante en un "Bolero Escrito" — un poema con espíritu de bolero. Responde SOLO con este formato, sin explicaciones adicionales, sin markdown:

TÍTULO: [un título breve y evocador]
DEDICATORIA: [una línea de dedicatoria, usa el nombre "para quién es" si te lo dieron]
[el poema: 3 a 4 estrofas cortas con espíritu de bolero, un estribillo si tiene sentido, y un cierre cálido — entre 90 y 160 palabras en total]

No reproduzcas letras de canciones existentes. No inventes datos personales que el usuario no te dio.`;

// Control básico de costos/abuso (fase 1, ver LEEME de esta entrega):
const MAX_TURNOS = 12;          // no dejar crecer la conversación sin límite
const MAX_CARACTERES_MSG = 4000; // ningún mensaje individual absurdamente largo
const MAX_TOKENS_RESPUESTA = 600;

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.ANTHROPIC_API_KEY) {
      return jsonError('El servidor no tiene configurada la clave de Anthropic.', 500);
    }

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return jsonError('Falta la conversación (messages).', 400);
    }

    const messages = body.messages.slice(-MAX_TURNOS);
    for (const m of messages) {
      if (
        typeof m.content !== 'string' ||
        m.content.length === 0 ||
        m.content.length > MAX_CARACTERES_MSG ||
        (m.role !== 'user' && m.role !== 'assistant')
      ) {
        return jsonError('La conversación tiene un formato inválido.', 400);
      }
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: MAX_TOKENS_RESPUESTA,
        system: DON_ERNESTO_SYSTEM,
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const detalle = await anthropicRes.text().catch(() => '');
      console.error('Error de Anthropic:', anthropicRes.status, detalle);
      return jsonError('Don Ernesto no pudo terminar el bolero en este momento.', 502);
    }

    const data = await anthropicRes.json();
    const text = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!text) {
      return jsonError('Don Ernesto no encontró las palabras esta vez. Intenta de nuevo.', 502);
    }

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('Error inesperado en /api/bolero:', err);
    return jsonError('Ocurrió un error inesperado.', 500);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
