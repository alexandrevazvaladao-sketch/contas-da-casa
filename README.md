# Contas da Casa

App web (PWA) para o casal controlar as contas de casa: resumo do mês, extrato, contas a pagar,
parcelas do cartão, modo Mercado (soma item a item + foto da nota), controle do iFood,
leitura de boleto / Pix copia e cola / aviso do banco, importação da fatura CSV do Nubank e acerto do casal.

- Hospedagem: GitHub Pages (arquivo único `index.html`).
- Dados e login: Firebase (projeto `contas-da-casa-48988`), coleções `contas` e `contasMeses`.
  Quem pode ler/gravar é definido nas regras do Firestore (só os e-mails do casal).
- Foto da nota: Firebase AI Logic (Gemini Developer API, plano gratuito).
- Funciona sem internet: o Firestore guarda no celular e sincroniza quando a conexão volta.
