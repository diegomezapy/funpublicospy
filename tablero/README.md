# Transparencia Paraguay, tablero auditado

Aplicación web en React + Vite + DuckDB WASM para exploración de datos salariales y estructura de cotizantes del sector público paraguayo.

## Estado de la auditoría

Esta versión fue revisada para reducir fallas de operación y de interpretación. Incluye:

- saneamiento de entrada para consultas por cédula
- mejora de mensajes de error
- corrección de un recurso CSS inválido
- banner de lectura responsable para evitar sobreinterpretación
- limpieza del estado de búsqueda
- endurecimiento básico frente a inyecciones por filtros de texto

## Advertencias metodológicas

- Los paneles descriptivos generales trabajan con vínculos de pago y agregados administrativos, no siempre con personas únicas.
- Los escenarios de sostenibilidad son simulaciones paramétricas. Sirven para dimensionar trayectorias y sensibilidades, no para reemplazar una valuación actuarial formal.
- Antes de publicar la app, conviene validar el contenido de `public/database` y contrastar los resultados con cuadros oficiales.

## Uso

```bash
npm install
npm run dev
```

Para compilación de producción:

```bash
npm run build
```
