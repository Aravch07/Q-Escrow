.PHONY: test demo web compile
test:
	python -m pytest tests -q
demo:
	python scripts/demo_offline.py
web:
	python -m webapp --seed-demo
compile:
	node scripts/compile.js
