# Instalily PartSelect Agent — AWS 部署信息

> 区域: us-east-2 | 账号: 554487657884 | 创建日期: 2026-06-11

## EC2
- 实例 ID: `i-01c8fe9496075c166`
- Name 标签: `instalily_project`
- 类型: t3.small (2 vCPU / 2GB), Ubuntu 24.04, 30GB gp3
- 公网 IP: `3.134.104.85`(重启会变,后续建议绑 Elastic IP)
- SSH: `ssh -i instalily-key.pem ubuntu@3.134.104.85`(密钥在本目录,仅允许 76.36.238.226 访问)

## 安全组
- `instalily-web-sg` = sg-0ee11c942d565ab00(80/443 公开,22 仅限本机 IP)
- `instalily-db-sg` = sg-08e90a1dbf05d77b8(5432 仅允许 web-sg)

## RDS
- 标识符: `instalily-db`,PostgreSQL,db.t4g.micro,20GB gp3
- 数据库名: `partselect`,用户: `psadmin`
- 密码: 见本目录 `.deploy-secrets`(已 gitignore,勿提交)
- 不对公网开放,只能从 EC2 访问
- Endpoint: `instalily-db.cnak2yye03in.us-east-2.rds.amazonaws.com:5432`(状态 available)

## Bedrock(us-east-2 可见)
- 对话模型: anthropic.claude-* 系列(待 invoke 测试确认访问权限)
- Embedding: `amazon.titan-embed-text-v2:0`(1024 维)

## 网络
- VPC: vpc-04f8d9b58c18c2c6c(默认)
- 子网: subnet-0efceaeb404466c32 (us-east-2c)
- AMI: ami-0ea1cddefe0c4aed5 (ubuntu-noble-24.04, 20260610)

## 待办
- [ ] Elastic IP 绑定
- [ ] RDS endpoint 记录
- [ ] Bedrock invoke 权限实测
- [ ] 域名 Route53 解析 + ACM/certbot 证书(域名待用户提供)
