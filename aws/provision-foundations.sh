#!/bin/bash
# provision-foundations.sh — one-time AWS infrastructure setup for Alfanumrik
# Run AFTER attaching AdministratorAccess to alfanumrik-admin in the console.
# Safe to re-run: uses check-before-create patterns throughout.
set -euo pipefail

# ── Variables ────────────────────────────────────────────────────────────────
ACCOUNT_ID="032064442164"
REGION="ap-south-1"
APP="alfa"
ENV="prod"
PREFIX="${APP}-${ENV}"
VPC_CIDR="10.20.0.0/16"
GITHUB_ORG="AlfanumrikOS"
GITHUB_REPO="Alfanumrik"

echo "=== Alfanumrik AWS Foundation Provisioning ==="
echo "Account: $ACCOUNT_ID | Region: $REGION | Prefix: $PREFIX"
echo ""

# ── KMS Key ─────────────────────────────────────────────────────────────────
echo "=== KMS: Creating encryption key ==="
EXISTING_KMS=$(aws kms list-aliases --region "$REGION" \
  --query "Aliases[?AliasName=='alias/${PREFIX}'].TargetKeyId" --output text 2>/dev/null || echo "")
if [ -z "$EXISTING_KMS" ]; then
  KEY_ID=$(aws kms create-key --region "$REGION" \
    --description "Alfanumrik production encryption key" \
    --query 'KeyMetadata.KeyId' --output text)
  aws kms create-alias --region "$REGION" \
    --alias-name "alias/${PREFIX}" --target-key-id "$KEY_ID"
  echo "KMS key created: $KEY_ID (alias: alias/${PREFIX})"
else
  KEY_ID="$EXISTING_KMS"
  echo "KMS key already exists: $KEY_ID"
fi

# ── Secrets Manager ──────────────────────────────────────────────────────────
echo ""
echo "=== Secrets Manager: Creating placeholder secret ==="
EXISTING_SECRET=$(aws secretsmanager list-secrets --region "$REGION" \
  --query "SecretList[?Name=='${PREFIX}/app'].Name" --output text 2>/dev/null || echo "")
if [ -z "$EXISTING_SECRET" ]; then
  aws secretsmanager create-secret \
    --name "${PREFIX}/app" \
    --region "$REGION" \
    --kms-key-id "alias/${PREFIX}" \
    --description "Alfanumrik production server secrets (fill via console before first ECS deploy)" \
    --secret-string '{"placeholder":"FILL_ALL_VALUES_VIA_CONSOLE_BEFORE_DEPLOY"}'
  echo "Secret created: ${PREFIX}/app — IMPORTANT: fill real values in console before deploying"
else
  echo "Secret already exists: ${PREFIX}/app"
fi

# ── ECR Repository ───────────────────────────────────────────────────────────
echo ""
echo "=== ECR: Creating container registry ==="
EXISTING_ECR=$(aws ecr describe-repositories --region "$REGION" \
  --repository-names "${APP}-web" --query 'repositories[0].repositoryUri' \
  --output text 2>/dev/null || echo "")
if [ -z "$EXISTING_ECR" ] || [ "$EXISTING_ECR" = "None" ]; then
  ECR_URI=$(aws ecr create-repository \
    --repository-name "${APP}-web" \
    --region "$REGION" \
    --image-tag-mutability IMMUTABLE \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=KMS,kmsKey="alias/${PREFIX}" \
    --query 'repository.repositoryUri' --output text)
  echo "ECR repository: $ECR_URI"
else
  ECR_URI="$EXISTING_ECR"
  echo "ECR already exists: $ECR_URI"
fi

# ── VPC ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== VPC: Creating network ==="
VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" \
  --filters "Name=tag:Name,Values=${PREFIX}" \
  --query 'Vpcs[0].VpcId' --output text 2>/dev/null || echo "None")
if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  VPC_ID=$(aws ec2 create-vpc --region "$REGION" \
    --cidr-block "$VPC_CIDR" \
    --query 'Vpc.VpcId' --output text)
  aws ec2 modify-vpc-attribute --region "$REGION" --vpc-id "$VPC_ID" --enable-dns-hostnames
  aws ec2 modify-vpc-attribute --region "$REGION" --vpc-id "$VPC_ID" --enable-dns-support
  aws ec2 create-tags --region "$REGION" --resources "$VPC_ID" \
    --tags Key=Name,Value="${PREFIX}" Key=App,Value="${APP}"
  echo "VPC created: $VPC_ID"
else
  echo "VPC already exists: $VPC_ID"
fi

# Public subnets (ALB, NAT Gateway)
echo "Creating subnets..."
PUB_1A=$(aws ec2 create-subnet --region "$REGION" --vpc-id "$VPC_ID" \
  --cidr-block "10.20.1.0/24" --availability-zone "${REGION}a" \
  --query 'Subnet.SubnetId' --output text 2>/dev/null || \
  aws ec2 describe-subnets --region "$REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=cidr-block,Values=10.20.1.0/24" \
  --query 'Subnets[0].SubnetId' --output text)
aws ec2 create-tags --region "$REGION" --resources "$PUB_1A" \
  --tags Key=Name,Value="${PREFIX}-public-1a" Key=Type,Value=public 2>/dev/null || true

PUB_1B=$(aws ec2 create-subnet --region "$REGION" --vpc-id "$VPC_ID" \
  --cidr-block "10.20.2.0/24" --availability-zone "${REGION}b" \
  --query 'Subnet.SubnetId' --output text 2>/dev/null || \
  aws ec2 describe-subnets --region "$REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=cidr-block,Values=10.20.2.0/24" \
  --query 'Subnets[0].SubnetId' --output text)
aws ec2 create-tags --region "$REGION" --resources "$PUB_1B" \
  --tags Key=Name,Value="${PREFIX}-public-1b" Key=Type,Value=public 2>/dev/null || true

PUB_1C=$(aws ec2 create-subnet --region "$REGION" --vpc-id "$VPC_ID" \
  --cidr-block "10.20.3.0/24" --availability-zone "${REGION}c" \
  --query 'Subnet.SubnetId' --output text 2>/dev/null || \
  aws ec2 describe-subnets --region "$REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=cidr-block,Values=10.20.3.0/24" \
  --query 'Subnets[0].SubnetId' --output text)
aws ec2 create-tags --region "$REGION" --resources "$PUB_1C" \
  --tags Key=Name,Value="${PREFIX}-public-1c" Key=Type,Value=public 2>/dev/null || true

# Private subnets (Fargate tasks, ElastiCache)
PRIV_1A=$(aws ec2 create-subnet --region "$REGION" --vpc-id "$VPC_ID" \
  --cidr-block "10.20.11.0/24" --availability-zone "${REGION}a" \
  --query 'Subnet.SubnetId' --output text 2>/dev/null || \
  aws ec2 describe-subnets --region "$REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=cidr-block,Values=10.20.11.0/24" \
  --query 'Subnets[0].SubnetId' --output text)
aws ec2 create-tags --region "$REGION" --resources "$PRIV_1A" \
  --tags Key=Name,Value="${PREFIX}-private-1a" Key=Type,Value=private 2>/dev/null || true

PRIV_1B=$(aws ec2 create-subnet --region "$REGION" --vpc-id "$VPC_ID" \
  --cidr-block "10.20.12.0/24" --availability-zone "${REGION}b" \
  --query 'Subnet.SubnetId' --output text 2>/dev/null || \
  aws ec2 describe-subnets --region "$REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=cidr-block,Values=10.20.12.0/24" \
  --query 'Subnets[0].SubnetId' --output text)
aws ec2 create-tags --region "$REGION" --resources "$PRIV_1B" \
  --tags Key=Name,Value="${PREFIX}-private-1b" Key=Type,Value=private 2>/dev/null || true

PRIV_1C=$(aws ec2 create-subnet --region "$REGION" --vpc-id "$VPC_ID" \
  --cidr-block "10.20.13.0/24" --availability-zone "${REGION}c" \
  --query 'Subnet.SubnetId' --output text 2>/dev/null || \
  aws ec2 describe-subnets --region "$REGION" \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=cidr-block,Values=10.20.13.0/24" \
  --query 'Subnets[0].SubnetId' --output text)
aws ec2 create-tags --region "$REGION" --resources "$PRIV_1C" \
  --tags Key=Name,Value="${PREFIX}-private-1c" Key=Type,Value=private 2>/dev/null || true

echo "Subnets: public=$PUB_1A/$PUB_1B/$PUB_1C private=$PRIV_1A/$PRIV_1B/$PRIV_1C"

# Internet Gateway
echo "Creating Internet Gateway..."
IGW_ID=$(aws ec2 describe-internet-gateways --region "$REGION" \
  --filters "Name=attachment.vpc-id,Values=$VPC_ID" \
  --query 'InternetGateways[0].InternetGatewayId' --output text 2>/dev/null || echo "None")
if [ "$IGW_ID" = "None" ] || [ -z "$IGW_ID" ]; then
  IGW_ID=$(aws ec2 create-internet-gateway --region "$REGION" \
    --query 'InternetGateway.InternetGatewayId' --output text)
  aws ec2 attach-internet-gateway --region "$REGION" \
    --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
  aws ec2 create-tags --region "$REGION" --resources "$IGW_ID" \
    --tags Key=Name,Value="${PREFIX}-igw"
fi
echo "IGW: $IGW_ID"

# NAT Gateway (one AZ to start; add more at 100K scale)
echo "Creating NAT Gateway (1 AZ — expand at 100K)..."
EIP_ALLOC=$(aws ec2 allocate-address --region "$REGION" --domain vpc \
  --query 'AllocationId' --output text)
NAT_ID=$(aws ec2 create-nat-gateway --region "$REGION" \
  --subnet-id "$PUB_1A" --allocation-id "$EIP_ALLOC" \
  --query 'NatGateway.NatGatewayId' --output text)
aws ec2 create-tags --region "$REGION" --resources "$NAT_ID" \
  --tags Key=Name,Value="${PREFIX}-nat-1a"
echo "NAT Gateway: $NAT_ID (waiting for available state...)"
aws ec2 wait nat-gateway-available --region "$REGION" --nat-gateway-ids "$NAT_ID"
echo "NAT Gateway ready."

# Route Tables
echo "Creating route tables..."
# Public RT
PUB_RT=$(aws ec2 create-route-table --region "$REGION" --vpc-id "$VPC_ID" \
  --query 'RouteTable.RouteTableId' --output text)
aws ec2 create-route --region "$REGION" --route-table-id "$PUB_RT" \
  --destination-cidr-block "0.0.0.0/0" --gateway-id "$IGW_ID"
aws ec2 create-tags --region "$REGION" --resources "$PUB_RT" \
  --tags Key=Name,Value="${PREFIX}-public-rt"
for SUBNET in "$PUB_1A" "$PUB_1B" "$PUB_1C"; do
  aws ec2 associate-route-table --region "$REGION" \
    --route-table-id "$PUB_RT" --subnet-id "$SUBNET" > /dev/null
done

# Private RT
PRIV_RT=$(aws ec2 create-route-table --region "$REGION" --vpc-id "$VPC_ID" \
  --query 'RouteTable.RouteTableId' --output text)
aws ec2 create-route --region "$REGION" --route-table-id "$PRIV_RT" \
  --destination-cidr-block "0.0.0.0/0" --nat-gateway-id "$NAT_ID"
aws ec2 create-tags --region "$REGION" --resources "$PRIV_RT" \
  --tags Key=Name,Value="${PREFIX}-private-rt"
for SUBNET in "$PRIV_1A" "$PRIV_1B" "$PRIV_1C"; do
  aws ec2 associate-route-table --region "$REGION" \
    --route-table-id "$PRIV_RT" --subnet-id "$SUBNET" > /dev/null
done
echo "Route tables configured."

# ── Security Groups ──────────────────────────────────────────────────────────
echo ""
echo "=== Security Groups ==="
ALB_SG=$(aws ec2 create-security-group --region "$REGION" \
  --group-name "${PREFIX}-alb-sg" --description "ALB security group" \
  --vpc-id "$VPC_ID" --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --region "$REGION" \
  --group-id "$ALB_SG" --protocol tcp --port 443 --cidr "0.0.0.0/0"
aws ec2 authorize-security-group-ingress --region "$REGION" \
  --group-id "$ALB_SG" --protocol tcp --port 80 --cidr "0.0.0.0/0"
aws ec2 create-tags --region "$REGION" --resources "$ALB_SG" \
  --tags Key=Name,Value="${PREFIX}-alb-sg"

ECS_SG=$(aws ec2 create-security-group --region "$REGION" \
  --group-name "${PREFIX}-ecs-sg" --description "ECS Fargate task security group" \
  --vpc-id "$VPC_ID" --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --region "$REGION" \
  --group-id "$ECS_SG" --protocol tcp --port 3000 --source-group "$ALB_SG"
aws ec2 create-tags --region "$REGION" --resources "$ECS_SG" \
  --tags Key=Name,Value="${PREFIX}-ecs-sg"

CACHE_SG=$(aws ec2 create-security-group --region "$REGION" \
  --group-name "${PREFIX}-cache-sg" --description "ElastiCache Redis security group" \
  --vpc-id "$VPC_ID" --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --region "$REGION" \
  --group-id "$CACHE_SG" --protocol tcp --port 6379 --source-group "$ECS_SG"
aws ec2 create-tags --region "$REGION" --resources "$CACHE_SG" \
  --tags Key=Name,Value="${PREFIX}-cache-sg"
echo "Security groups: alb=$ALB_SG ecs=$ECS_SG cache=$CACHE_SG"

# ── ACM Certificate ──────────────────────────────────────────────────────────
echo ""
echo "=== ACM: Requesting TLS certificate (DNS validation) ==="
CERT_ARN=$(aws acm request-certificate --region "$REGION" \
  --domain-name "alfanumrik.com" \
  --subject-alternative-names "*.alfanumrik.com" \
  --validation-method DNS \
  --query 'CertificateArn' --output text)
echo "Certificate requested: $CERT_ARN"
echo "ACTION REQUIRED: Add the DNS CNAME validation records shown in ACM console,"
echo "then re-run or wait for certificate status = ISSUED before creating the ALB HTTPS listener."

# ── ECS Cluster ──────────────────────────────────────────────────────────────
echo ""
echo "=== ECS: Creating cluster ==="
aws ecs create-cluster \
  --cluster-name "${PREFIX}" \
  --capacity-providers FARGATE FARGATE_SPOT \
  --default-capacity-provider-strategy \
    capacityProvider=FARGATE,weight=4,base=2 \
    capacityProvider=FARGATE_SPOT,weight=1 \
  --region "$REGION" \
  --settings name=containerInsights,value=enabled > /dev/null
echo "ECS cluster: ${PREFIX}"

# ── IAM Roles ────────────────────────────────────────────────────────────────
echo ""
echo "=== IAM: Creating ECS roles ==="

# ECS execution role (pulls ECR images + Secrets Manager)
EXEC_ROLE_ARN=$(aws iam create-role --role-name "${PREFIX}-ecs-execution" \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --query 'Role.Arn' --output text 2>/dev/null || \
  aws iam get-role --role-name "${PREFIX}-ecs-execution" --query 'Role.Arn' --output text)
aws iam attach-role-policy --role-name "${PREFIX}-ecs-execution" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" 2>/dev/null || true
# Allow reading our specific Secrets Manager secret
aws iam put-role-policy --role-name "${PREFIX}-ecs-execution" \
  --policy-name "allow-secrets-manager" \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"secretsmanager:GetSecretValue\",\"kms:Decrypt\"],\"Resource\":[\"arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:${PREFIX}/app*\",\"arn:aws:kms:${REGION}:${ACCOUNT_ID}:key/*\"]}]}"
echo "Execution role: $EXEC_ROLE_ARN"

# ECS task role (app runtime permissions — minimal)
TASK_ROLE_ARN=$(aws iam create-role --role-name "${PREFIX}-ecs-task" \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --query 'Role.Arn' --output text 2>/dev/null || \
  aws iam get-role --role-name "${PREFIX}-ecs-task" --query 'Role.Arn' --output text)
echo "Task role: $TASK_ROLE_ARN"

# GitHub Actions deploy role (OIDC)
GITHUB_DEPLOY_ROLE=$(aws iam create-role --role-name "${PREFIX}-github-deploy" \
  --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Federated\":\"arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com\"},\"Action\":\"sts:AssumeRoleWithWebIdentity\",\"Condition\":{\"StringEquals\":{\"token.actions.githubusercontent.com:aud\":\"sts.amazonaws.com\"},\"StringLike\":{\"token.actions.githubusercontent.com:sub\":\"repo:${GITHUB_ORG}/${GITHUB_REPO}:*\"}}}]}" \
  --query 'Role.Arn' --output text 2>/dev/null || \
  aws iam get-role --role-name "${PREFIX}-github-deploy" --query 'Role.Arn' --output text)
aws iam put-role-policy --role-name "${PREFIX}-github-deploy" \
  --policy-name "ecs-ecr-deploy" \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"ecr:GetAuthorizationToken\"],\"Resource\":\"*\"},{\"Effect\":\"Allow\",\"Action\":[\"ecr:BatchCheckLayerAvailability\",\"ecr:GetDownloadUrlForLayer\",\"ecr:BatchGetImage\",\"ecr:InitiateLayerUpload\",\"ecr:UploadLayerPart\",\"ecr:CompleteLayerUpload\",\"ecr:PutImage\"],\"Resource\":\"arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${APP}-web\"},{\"Effect\":\"Allow\",\"Action\":[\"ecs:UpdateService\",\"ecs:RegisterTaskDefinition\",\"ecs:DescribeServices\",\"ecs:DescribeTaskDefinition\"],\"Resource\":\"*\"},{\"Effect\":\"Allow\",\"Action\":\"iam:PassRole\",\"Resource\":[\"arn:aws:iam::${ACCOUNT_ID}:role/${PREFIX}-ecs-execution\",\"arn:aws:iam::${ACCOUNT_ID}:role/${PREFIX}-ecs-task\"]}]}"
echo "GitHub deploy role: $GITHUB_DEPLOY_ROLE"

# ── CloudWatch Logs ──────────────────────────────────────────────────────────
echo ""
echo "=== CloudWatch: Creating log group ==="
aws logs create-log-group --log-group-name "/ecs/${APP}-web" \
  --region "$REGION" 2>/dev/null || true
aws logs put-retention-policy --log-group-name "/ecs/${APP}-web" \
  --retention-in-days 30 --region "$REGION"
echo "Log group: /ecs/${APP}-web (30-day retention)"

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "=========================================================="
echo "  FOUNDATION PROVISIONING COMPLETE"
echo "=========================================================="
echo "VPC:           $VPC_ID"
echo "Public subnets: $PUB_1A / $PUB_1B / $PUB_1C"
echo "Private subnets: $PRIV_1A / $PRIV_1B / $PRIV_1C"
echo "NAT Gateway:   $NAT_ID"
echo "ECR:           $ECR_URI"
echo "ECS Cluster:   ${PREFIX}"
echo "ALB SG:        $ALB_SG"
echo "ECS SG:        $ECS_SG"
echo "ACM Cert:      $CERT_ARN (VALIDATE DNS IN CONSOLE)"
echo "Deploy Role:   $GITHUB_DEPLOY_ROLE"
echo ""
echo "NEXT STEPS:"
echo "1. Validate ACM certificate DNS records in Route 53"
echo "2. Create ALB + target group + HTTPS listener (requires valid cert)"
echo "3. Fill real values in Secrets Manager: ${PREFIX}/app"
echo "4. Set GitHub secret AWS_DEPLOY_ROLE_ARN = $GITHUB_DEPLOY_ROLE"
echo "5. Set GitHub variable ENABLE_AWS_DEPLOY = false (flip to true during cutover)"
echo "6. Push to main — workflow builds image but does not deploy yet"
echo "=========================================================="
