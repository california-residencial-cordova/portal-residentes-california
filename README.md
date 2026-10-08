# Portal de Residentes — California Residencial

App separada (proyecto personal, sin relación con tu cuenta de trabajo)
para el control de visitas y el padrón de residentes, con login por
persona usando Supabase.

## Qué incluye

- `supabase/schema.sql` — toda la base de datos (tablas, seguridad, trigger de alta automática). Se corre una sola vez en tu proyecto de Supabase.
- `web/` — la aplicación (HTML/CSS/JS plano, sin frameworks ni build). Se hospeda como sitio estático.

## Paso 1 — Crear el proyecto de Supabase (cuenta personal)

1. Entra a https://supabase.com y crea una cuenta **personal** (con tu correo personal, no el del trabajo).
2. Crea un nuevo proyecto. Elige una contraseña de base de datos y guárdala en un lugar seguro (no la necesitarás para esta app, pero Supabase la pide).
3. Espera a que el proyecto termine de aprovisionarse (1–2 minutos).

## Paso 2 — Cargar el esquema de base de datos

1. En el panel de tu proyecto, ve a **SQL Editor** → **New query**.
2. Abre el archivo `supabase/schema.sql` de esta carpeta, copia todo su contenido y pégalo ahí.
3. Presiona **Run**. Deberías ver "Success. No rows returned".

Esto crea las tablas `residentes` y `visitas`, la seguridad por fila (cada quien ve solo lo suyo; el comité ve todo), y el alta automática de cada quien que se registre.

## Paso 3 — Obtener tus llaves de conexión

1. Ve a **Project Settings** → **API**.
2. Copia el **Project URL** y la **anon public key** (NO la "service_role key" — esa es secreta).
3. En la carpeta `web/`, haz una copia de `config.example.js` y renómbrala a `config.js`.
4. Pega ahí tu Project URL y tu anon key.

`config.js` queda fuera del repositorio (ver `.gitignore`) para que no publiques tu configuración por accidente — aunque la anon key es segura de exponer, es buena práctica mantenerla fuera del control de versiones.

## Paso 4 — Crear tu usuario de comité

1. Publica la app (paso 5) o ábrela localmente, y regístrate normalmente con tu nombre, domicilio y correo.
2. En Supabase, ve a **SQL Editor** y corre (cambiando el correo por el tuyo):

```sql
update public.residentes set rol = 'comite'
where id = (select id from auth.users where email = 'tu_correo@ejemplo.com');
```

3. Cierra sesión y vuelve a entrar en la app — ahora verás las pestañas de **Padrón** y **Control de visitas** (todas), en lugar de solo las tuyas.
4. Desde ahí, tú mismo puedes dar de alta a otros miembros del comité cambiando su "Rol" en la tabla del padrón.

## Paso 5 — Publicar con GitHub Pages (cuenta personal)

1. En tu cuenta **personal** de GitHub (no la organización del trabajo), crea un repositorio nuevo, por ejemplo `portal-residentes-california`.
2. Sube el contenido de la carpeta `web/` (incluyendo tu `config.js` ya editado) a ese repositorio.
3. En el repositorio, ve a **Settings** → **Pages**.
4. En "Source", elige la rama `main` y la carpeta `/ (root)`. Guarda.
5. En un par de minutos, GitHub te da una URL pública como `https://tu-usuario.github.io/portal-residentes-california/`.

## Paso 6 — Enlazar desde el Portal Vecinal

Una vez que tengas la URL publicada, dime cuál es y agrego un botón de "Control de visitas / Mi cuenta" en el Portal Vecinal que enlace a esa página.

## Notas de seguridad

- La "anon key" es pública por diseño (es la misma que usa cualquier app de navegador con Supabase); la protección real la dan las políticas de seguridad por fila (RLS) ya incluidas en `schema.sql`.
- Nunca compartas ni publiques la "service_role key" — esta app no la necesita en ningún lugar.
- El campo de "tipo de ocupación" (propietario / arrendatario / posesión irregular) solo es visible y editable por cuentas con rol "comité".
