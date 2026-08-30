FROM nginx:1.27-alpine

COPY index.html styles.css app.js lessons.json /usr/share/nginx/html/

# Static assets are immutable per image; nginx serves the lesson data separately
# so instructors can extend lessons.json without changing application code.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
