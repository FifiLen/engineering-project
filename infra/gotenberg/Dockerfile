# Silnik dokumentów (ADR 0066): Gotenberg 9.5.1 przypięty do digestu, z czcionką Inter 4.1
# (statyczne TTF z wydania rsms/inter, licencja OFL), żeby DOCX i HTML miały krój z design systemu.
FROM gotenberg/gotenberg:9.5.1@sha256:a0f596c2aeee6391c24ccf2953737971f13976b14d4240525a447f209185e2c8
USER root
COPY fonts/inter/ /usr/local/share/fonts/inter/
RUN fc-cache -f
USER gotenberg
