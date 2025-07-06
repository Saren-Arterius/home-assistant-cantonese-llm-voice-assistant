FROM alpine:latest

WORKDIR /

RUN \
    apk update \
    && apk add \
        bash \
        wget

COPY run.sh /

RUN chmod +x /run.sh

CMD /run.sh
