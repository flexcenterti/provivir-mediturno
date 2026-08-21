/** Formas del webhook de Meta que la plataforma consume (Cloud API v20+). */
export interface WebhookMeta {
  object: string;
  entry?: EntradaWebhook[];
}

export interface EntradaWebhook {
  id: string;
  changes?: Array<{ field: string; value: ValorCambio }>;
}

export interface ValorCambio {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  /**
   * Con nombres de usuario de WhatsApp el contacto no trae `wa_id` sino `user_id`,
   * y el perfil añade `username`. El identificador estable es `user_id`: el alias
   * lo puede cambiar el propio paciente.
   */
  contacts?: Array<{
    profile?: { name?: string; username?: string };
    wa_id?: string;
    user_id?: string;
  }>;
  messages?: MensajeMeta[];
  statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }>;
}

export interface MensajeMeta {
  id: string;
  /** Teléfono del remitente. Ausente si el paciente usa nombre de usuario. */
  from?: string;
  /** Identificador del remitente cuando usa nombre de usuario ("US.1349…"). */
  from_user_id?: string;
  timestamp: string;
  type: 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker' | 'location' | 'button' | 'interactive';
  text?: { body: string };
  audio?: MediaMeta;
  image?: MediaMeta & { caption?: string };
  video?: MediaMeta & { caption?: string };
  document?: MediaMeta & { filename?: string; caption?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  context?: { id?: string };
}

export interface MediaMeta {
  id: string;
  mime_type?: string;
  sha256?: string;
  voice?: boolean;
}

/** Normalización interna: el resto de la plataforma no conoce el formato de Meta. */
export interface MensajeEntrante {
  waMessageId: string;
  telefono: string;
  nombrePerfil?: string;
  tipo: 'texto' | 'audio' | 'imagen' | 'video' | 'documento' | 'sistema';
  texto?: string;
  mediaId?: string;
  mimeType?: string;
  /** Marca las notas de voz frente a un audio adjunto cualquiera. */
  esNotaDeVoz?: boolean;
  ts: Date;
}
