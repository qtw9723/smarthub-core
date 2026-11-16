-- 허브 기본값 제거 — 예전에 특정 허브 UUID를 hub_id 기본값으로 박아 둔 잔재.
-- 지금 코드는 세 테이블 INSERT에서 hub_id를 항상 넘긴다.
-- common baseline에는 이 기본값이 없다(사내 빈 DB에서는 FK 위반) — 외부 DB도 지워 두 스키마를 맞춘다. 멱등.
alter table mail_jobs alter column hub_id drop default;
alter table sender_accounts alter column hub_id drop default;
alter table grafana_log_types alter column hub_id drop default;
