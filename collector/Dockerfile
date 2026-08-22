FROM --platform=$BUILDPLATFORM golang:1.21-alpine AS build

ARG TARGETOS
ARG TARGETARCH

WORKDIR /src
COPY go.mod ./
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w" -o /out/qollect-collector .

FROM alpine:3.20

RUN addgroup -S qollect && adduser -S -G qollect qollect \
    && mkdir -p /data/events \
    && chown -R qollect:qollect /data

COPY --from=build /out/qollect-collector /usr/local/bin/qollect-collector

USER qollect
VOLUME ["/data"]
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/qollect-collector"]
