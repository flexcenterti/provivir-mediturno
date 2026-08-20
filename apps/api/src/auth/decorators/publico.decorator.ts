import { SetMetadata } from '@nestjs/common';

export const CLAVE_PUBLICO = 'esPublico';

/** Marca una ruta como accesible sin token. Por defecto TODO exige autenticación. */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);
