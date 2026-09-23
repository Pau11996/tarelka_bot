FROM nginx:1.27-alpine

RUN apk add --no-cache gettext wget

COPY nginx.conf.template /opt/nginx.conf.template
COPY public/ /usr/share/nginx/html/
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
