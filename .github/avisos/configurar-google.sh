#!/bin/bash
# Liga o GitHub Actions deste repositório ao Firebase SEM chave (Workload Identity Federation).
# Rodar uma vez no Cloud Shell do projeto contas-da-casa-48988.
set -e
P=contas-da-casa-48988
R=alexandrevazvaladao-sketch/contas-da-casa
N=$(gcloud projects describe $P --format='value(projectNumber)')
SA=firebase-adminsdk-fbsvc@$P.iam.gserviceaccount.com
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project $P
gcloud iam workload-identity-pools describe github --project $P --location global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --project $P --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers describe contas --project $P --location global --workload-identity-pool github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc contas --project $P --location global --workload-identity-pool github \
    --display-name "Repo contas-da-casa" --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition "assertion.repository=='$R'"
gcloud iam service-accounts add-iam-policy-binding $SA --project $P --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$N/locations/global/workloadIdentityPools/github/attribute.repository/$R" --format=none
echo "PRONTO projeto=$N"
