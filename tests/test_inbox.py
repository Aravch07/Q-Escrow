import json
import pytest
from webapp.inbox import agreement_summary, build_inbox, sender_for


def record(state='PROPOSED', id='a'*64):
    body={'terms':{'description':' Brand package & handoff ', 'buyer':{'name':'alice','public_key':'do-not-expose'},'seller':{'name':'bob'}},
          'delivery':None,'acceptance':None,'settlement':None,'cancellation':None,'rejection':None}
    if state in ('DELIVERED','ACCEPTED','SETTLED'):body['delivery']={'filename':'private.bin'}
    if state in ('ACCEPTED','SETTLED'):body['acceptance']={'decision':'release'}
    if state=='SETTLED':body['settlement']={'release':True}
    if state=='CANCELLED':body['cancellation']={'cancelled_by':'seller'}
    if state=='REJECTED':body['rejection']='Invalid signature'
    return {'id':id,'body':body,'seller_signed':state!='PROPOSED'}


@pytest.mark.parametrize('state',['PROPOSED','LOCKED','DELIVERED','ACCEPTED','SETTLED','CANCELLED','REJECTED'])
def test_current_status_and_party_metadata(state):
    row=record(state)
    summary=agreement_summary(row,'bob')
    assert summary['state']==state
    assert summary['title']=='Brand package & handoff'
    assert summary['counterparty']=='alice' and summary['created_by']=='alice'
    assert summary['role']=='seller'
    assert agreement_summary(row,'outsider') is None


@pytest.mark.parametrize(('event','snapshot','sender'),[
    ('proposed',None,'alice'),('countersigned',None,'bob'),('delivered',None,'bob'),
    ('decision_release',None,'alice'),('buyer_funding_updated',None,'alice'),
    ('bundle_imported','PROPOSED','alice'),('bundle_imported','LOCKED','bob'),
    ('bundle_imported','DELIVERED','bob'),('bundle_imported','ACCEPTED','alice'),
    ('funding_failure_recovered',None,None),('peer_settlement_observed',None,None),
])
def test_senders_follow_the_action_not_the_latest_agreement_status(event,snapshot,sender):
    row=record('SETTLED');summary=agreement_summary(row,'alice')
    assert sender_for({'event':event,'data':{'state':snapshot}},summary,'alice',row['body'])==sender


def test_cancel_sender_and_refund_label():
    row=record('CANCELLED');summary=agreement_summary(row,'alice')
    assert sender_for({'event':'peer_settlement_observed'},summary,'alice',row['body'])=='bob'
    row=record('SETTLED');row['body']['settlement']['release']=False
    assert agreement_summary(row,'alice')['status_label']=='Refunded'


def test_grouped_history_privacy_and_same_second_unread_cursor():
    row=record('SETTLED');rows=[]
    for id,state in [(3,'ACCEPTED'),(2,'DELIVERED'),(1,'PROPOSED')]:
        rows.append({'body':{'id':id,'event':'bundle_imported','at':100,'escrow_id':row['id'],'data':{'state':state}},'group_total':3,'group_unread':1})
    result=build_inbox('alice',rows,[row],seen_at=100,seen_id=2)
    assert len(result['agreements'])==1 and result['status_counts']['SETTLED']==1
    card=result['agreements'][0]
    assert len(card['events'])==3 and card['unread_count']==1
    assert card['events'][0]['unread'] and not card['events'][1]['unread']
    assert card['events'][0]['sender']=='alice' and card['events'][1]['sender']=='bob'
    raw=json.dumps(result)
    assert 'public_key' not in raw and 'do-not-expose' not in raw and 'private.bin' not in raw
    assert build_inbox('alice',rows,[row],seen_at=100)['events'][0]['unread'] is False


def test_other_party_records_and_unknown_actor_are_not_exposed():
    row=record();row['body']['terms']['description']='Another account private agreement'
    rows=[{'body':{'id':1,'event':'bundle_imported','at':100,'escrow_id':row['id'],'data':{'state':'PROPOSED','actor':'outsider'}}}]
    result=build_inbox('carol',rows,[row])
    assert result['agreements']==[] and result['events'][0]['escrow_id'] is None
    assert 'Another account private agreement' not in json.dumps(result)
    summary=agreement_summary(row,'bob')
    assert sender_for(rows[0]['body'],summary,'bob',row['body'])=='alice'
